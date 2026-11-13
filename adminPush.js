import webpush from 'web-push';
import { randomUUID } from 'node:crypto';

export function validatePushSubscription(input, fail) {
  if (!input || typeof input !== 'object') fail('Invalid notification subscription.');
  let url;
  try { url = new URL(input.endpoint); } catch { fail('Invalid notification endpoint.'); }
  const host = url.hostname.toLowerCase();
  const allowed = host === 'fcm.googleapis.com' || host === 'web.push.apple.com' ||
    host.endsWith('.push.services.mozilla.com') || host.endsWith('.notify.windows.com');
  if (url.protocol !== 'https:' || !allowed || url.username || url.password || url.hash ||
      (url.port && url.port !== '443') || url.href.length > 2048) fail('Unsupported notification service.');
  const p256dh = input.keys?.p256dh, auth = input.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' ||
      !/^[A-Za-z0-9_-]+={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(auth) ||
      Buffer.from(p256dh,'base64url').length !== 65 || Buffer.from(p256dh,'base64url')[0] !== 4 ||
      Buffer.from(auth,'base64url').length !== 16) fail('Invalid notification keys.');
  return {endpoint:url.href,keys:{p256dh,auth}};
}

export async function createAdminPush({db,q,one,run,gameTransaction,fail,sender=webpush}) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sfa_push_meta(
      id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sfa_push_subscriptions(
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      endpoint TEXT UNIQUE NOT NULL, body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sfa_push_events(
      id INTEGER PRIMARY KEY, event_key TEXT UNIQUE NOT NULL, payload TEXT NOT NULL,
      created BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sfa_push_deliveries(
      id INTEGER PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES sfa_push_events(id) ON DELETE CASCADE,
      subscription_id INTEGER NOT NULL REFERENCES sfa_push_subscriptions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
      next_at BIGINT NOT NULL DEFAULT 0,
      UNIQUE(event_id,subscription_id)
    );
    CREATE INDEX IF NOT EXISTS sfa_push_delivery_due ON sfa_push_deliveries(status,next_at);
  `);
  let keys;
  await gameTransaction(async () => {
    let stored = await one("SELECT value FROM sfa_push_meta WHERE key='vapid'");
    if (!stored) {
      await run("INSERT OR IGNORE INTO sfa_push_meta(key,value) VALUES('vapid',?)",JSON.stringify(sender.generateVAPIDKeys()));
      stored = await one("SELECT value FROM sfa_push_meta WHERE key='vapid'");
    }
    keys = JSON.parse(stored.value);
    if (!await one("SELECT value FROM sfa_push_meta WHERE key='cursor'")) {
      const requests = Number((await one('SELECT COALESCE(MAX(id),0) n FROM requests')).n);
      const users = Number((await one('SELECT COALESCE(MAX(id),0) n FROM users')).n);
      await run("INSERT OR IGNORE INTO sfa_push_meta(key,value) VALUES('cursor',?)",JSON.stringify({requests,users}));
    }
  });
  async function enqueue(eventKey,title,body,subscriptionId=null) {
    const payload = JSON.stringify({eventKey,title,body,url:'/admin'});
    await run('INSERT OR IGNORE INTO sfa_push_events(event_key,payload,created) VALUES(?,?,?)',eventKey,payload,Date.now());
    const event = await one('SELECT id FROM sfa_push_events WHERE event_key=?',eventKey);
    const subscribers = await q(`SELECT s.id FROM sfa_push_subscriptions s
      JOIN users u ON u.id=s.user_id WHERE u.role='admin' AND u.blocked=0
      ${subscriptionId === null ? '' : 'AND s.id=?'}`, ...(subscriptionId === null ? [] : [subscriptionId]));
    for (const s of subscribers) await run('INSERT OR IGNORE INTO sfa_push_deliveries(event_id,subscription_id) VALUES(?,?)',event.id,s.id);
  }
  const paths = new Set(['/api/admin/push-config','/api/admin/push-subscribe','/api/admin/push-unsubscribe','/api/admin/push-test']);
  async function handle(route,post,data,user) {
    if (!user || user.role !== 'admin' || user.blocked) fail('Admin access required',403);
    if (route === '/api/admin/push-config' && !post) return {publicKey:keys.publicKey};
    if (route === '/api/admin/push-subscribe' && post) {
      const sub = validatePushSubscription(data.subscription,fail);
      await run(`INSERT INTO sfa_push_subscriptions(user_id,endpoint,body) VALUES(?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,body=excluded.body`,user.id,sub.endpoint,JSON.stringify(sub));
      return {enabled:true};
    }
    if (route === '/api/admin/push-unsubscribe' && post) {
      await run('DELETE FROM sfa_push_subscriptions WHERE endpoint=? AND user_id=?',String(data.endpoint || ''),user.id);
      return {enabled:false};
    }
    if (route === '/api/admin/push-test' && post) {
      const sub = await one('SELECT id FROM sfa_push_subscriptions WHERE endpoint=? AND user_id=?',String(data.endpoint || ''),user.id);
      if (!sub) fail('Enable notifications on this device first.');
      await enqueue('test-'+randomUUID(),'Super Fast Aviator · Test alert','Notifications are enabled. Open the admin panel to review requests.',sub.id);
      return {queued:true};
    }
    fail('Method not allowed',405);
  }
  async function collectAndClaim() {
    return gameTransaction(async () => {
      const cursor = JSON.parse((await one("SELECT value FROM sfa_push_meta WHERE key='cursor'")).value);
      const requests = await q('SELECT id,type,amount FROM requests WHERE id>? ORDER BY id LIMIT 200',cursor.requests);
      for (const r of requests) {
        const title = r.type === 'WITHDRAWAL' ? 'New withdrawal request' : r.type === 'DEPOSIT' ? 'New deposit request' : 'New customer request';
        await enqueue('request-'+r.id,'Super Fast Aviator · '+title,`Request #${r.id} · ₹${Number(r.amount || 0).toLocaleString('en-IN')} · Review in Admin`);
        cursor.requests = Number(r.id);
      }
      const users = await q("SELECT id FROM users WHERE id>? AND role='customer' ORDER BY id LIMIT 200",cursor.users);
      for (const u of users) {
        await enqueue('customer-'+u.id,'Super Fast Aviator · New customer','A new customer account was registered. Review Customer IDs in Admin.');
        cursor.users = Number(u.id);
      }
      await run("UPDATE sfa_push_meta SET value=? WHERE key='cursor'",JSON.stringify(cursor));
      const now = Date.now();
      await run('DELETE FROM sfa_push_events WHERE created<?',now-7*86400000);
      const due = await q(`SELECT d.id,d.attempts,s.id subscription_id,s.body,e.payload
        FROM sfa_push_deliveries d JOIN sfa_push_events e ON e.id=d.event_id
        JOIN sfa_push_subscriptions s ON s.id=d.subscription_id JOIN users u ON u.id=s.user_id
        WHERE d.status IN ('PENDING','SENDING') AND d.next_at<=?
        AND u.role='admin' AND u.blocked=0 ORDER BY d.id LIMIT 20`,now);
      for (const d of due) await run("UPDATE sfa_push_deliveries SET status='SENDING',attempts=attempts+1,next_at=? WHERE id=?",now+60000,d.id);
      return due;
    });
  }
  async function deliver(d) {
    try {
      await sender.sendNotification(JSON.parse(d.body),d.payload,{
        vapidDetails:{subject:'https://super-fast-aviator.onrender.com/admin',publicKey:keys.publicKey,privateKey:keys.privateKey},
        TTL:3600,urgency:'high',timeout:8000,
      });
      await run("UPDATE sfa_push_deliveries SET status='SENT' WHERE id=?",d.id);
    } catch (error) {
      if ([404,410].includes(error.statusCode)) await run('DELETE FROM sfa_push_subscriptions WHERE id=?',d.subscription_id);
      else {
        const attempts = Number(d.attempts)+1;
        await run('UPDATE sfa_push_deliveries SET status=?,next_at=? WHERE id=?',attempts >= 8 ? 'FAILED' : 'PENDING',Date.now()+Math.min(3600000,5000*2**attempts),d.id);
        console.error('Admin push retry:',Number(error.statusCode) || 'delivery unavailable');
      }
    }
  }
  let stopped=false,working=false,current=Promise.resolve();
  function tick() {
    if (stopped || working) return current;
    working=true;
    current=(async () => {
      try {
        const due=await collectAndClaim();
        for(let i=0;i<due.length&&!stopped;i+=4) await Promise.all(due.slice(i,i+4).map(deliver));
      } catch (error) { console.error('Admin notification queue:',error.code || 'temporarily unavailable'); }
      finally { working=false; }
    })();
    return current;
  }
  const timer=setInterval(tick,5000); timer.unref();
  return {handles:route=>paths.has(route),handle,tick,stop:async()=>{stopped=true;clearInterval(timer);await current;}};
}
