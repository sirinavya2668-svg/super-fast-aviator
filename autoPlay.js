// Simulation-only auto bets and threshold cashouts. Call mutations inside withGame().
export async function createAutoPlay({db,q,one,run,credit,amount,fail}) {
  await db.exec(`
    ALTER TABLE bets ADD COLUMN IF NOT EXISTS auto_cashout REAL NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS sfa_auto_plans(
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      panel INTEGER NOT NULL, stake INTEGER NOT NULL, auto_cashout REAL NOT NULL DEFAULT 0,
      remaining INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 0,
      not_before_round INTEGER NOT NULL DEFAULT 0, last_round INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '', UNIQUE(user_id,panel)
    );
    CREATE INDEX IF NOT EXISTS sfa_auto_due ON sfa_auto_plans(enabled,not_before_round,last_round);
  `);
  function panel(value) {if(![1,2].includes(value))fail('Invalid bet panel.');return value;}
  function threshold(value) {
    if(value===undefined || value===null || value===0)return 0;
    if(typeof value!=='number' || !Number.isFinite(value) || value<1.01 || value>49.99 || Math.abs(value*100-Math.round(value*100))>0.000001)fail('Auto cash out must be 1.01–49.99x, with at most two decimals.');
    return Math.round(value*100)/100;
  }
  async function writeBet(userId,roundId,p,stake,target) {
    if(await one('SELECT id FROM bets WHERE user_id=? AND round_id=? AND panel=?',userId,roundId,p))return false;
    const u=await one('SELECT * FROM users WHERE id=?',userId);
    if(!u || u.role!=='customer' || u.blocked || u.must_change)fail('Customer account is unavailable.');
    if(Number(u.balance)<stake)fail('Insufficient balance.');
    await credit(userId,-stake,'Demo stake');
    await run('INSERT INTO bets(user_id,round_id,panel,stake,auto_cashout) VALUES(?,?,?,?,?)',userId,roundId,p,stake,target);
    return true;
  }
  async function placeManual(user,round,data) {
    if(round.phase!=='WAITING' || data.roundId!==round.id || (Number.isFinite(round.start) && Date.now()>=round.start))fail('Betting closed. Wait for the next round.');
    const p=panel(data.panel),stake=amount(data.amount,10),target=threshold(data.autoCashout);
    if(!await writeBet(user.id,round.id,p,stake,target))fail('Only one bet per panel per round.');
  }
  async function start(user,round,data) {
    const p=panel(data.panel),stake=amount(data.amount,10),target=threshold(data.autoCashout);
    if(!Number.isSafeInteger(data.rounds) || data.rounds<1 || data.rounds>100)fail('Choose 1–100 auto rounds.');
    const account=await one('SELECT balance FROM users WHERE id=?',user.id);
    if(!account || Number(account.balance)<stake)fail('Insufficient balance.');
    if(await one('SELECT id FROM sfa_auto_plans WHERE user_id=? AND panel=? AND enabled=1',user.id,p))fail('Auto is already running. Stop it before changing its settings.');
    const existing=await one('SELECT id FROM bets WHERE user_id=? AND round_id=? AND panel=?',user.id,round.id,p);
    const first=round.id+(round.phase!=='WAITING' || existing ? 1 : 0);
    await run(`INSERT INTO sfa_auto_plans(user_id,panel,stake,auto_cashout,remaining,enabled,not_before_round,last_round,last_error)
      VALUES(?,?,?,?,?,1,?,0,'') ON CONFLICT(user_id,panel) DO UPDATE SET
      stake=excluded.stake,auto_cashout=excluded.auto_cashout,remaining=excluded.remaining,
      enabled=1,not_before_round=excluded.not_before_round,last_round=0,last_error=''`,user.id,p,stake,target,data.rounds,first);
    if(round.phase==='WAITING')await place(round);
    return {started:true,firstRound:first};
  }
  async function stop(userId,p) {
    panel(p);await run("UPDATE sfa_auto_plans SET enabled=0,last_error='' WHERE user_id=? AND panel=?",userId,p);
    return {stopped:true};
  }
  async function stopAll(userId) {await run("UPDATE sfa_auto_plans SET enabled=0,last_error='' WHERE user_id=?",userId);}
  async function plans(userId) {
    return q('SELECT panel,stake,auto_cashout,remaining,enabled,last_round,last_error FROM sfa_auto_plans WHERE user_id=? ORDER BY panel',userId);
  }
  async function place(round) {
    if(round.phase!=='WAITING' || (Number.isFinite(round.start) && Date.now()>=round.start))return;
    const due=await q(`SELECT p.*,u.balance,u.blocked,u.must_change,u.role FROM sfa_auto_plans p
      JOIN users u ON u.id=p.user_id WHERE p.enabled=1 AND p.not_before_round<=?
      AND p.last_round<>? ORDER BY p.id`,round.id,round.id);
    for(const p of due) {
      if(Number.isFinite(round.start) && Date.now()>=round.start)break;
      if(p.remaining<=0 || p.blocked || p.must_change || p.role!=='customer' || Number(p.balance)<p.stake) {
        const reason=p.remaining<=0 ? '' : p.blocked || p.must_change || p.role!=='customer' ? 'Account unavailable' : 'Insufficient balance';
        await run('UPDATE sfa_auto_plans SET enabled=0,last_error=? WHERE id=?',reason,p.id);continue;
      }
      const duplicate=await one('SELECT id FROM bets WHERE user_id=? AND round_id=? AND panel=?',p.user_id,round.id,p.panel);
      if(duplicate){await run('UPDATE sfa_auto_plans SET last_round=? WHERE id=?',round.id,p.id);continue;}
      // Re-read the wallet: another panel may have spent from the same balance in this tick.
      const latest=await one('SELECT balance FROM users WHERE id=?',p.user_id);
      if(Number(latest.balance)<p.stake){await run("UPDATE sfa_auto_plans SET enabled=0,last_error='Insufficient balance' WHERE id=?",p.id);continue;}
      await writeBet(p.user_id,round.id,p.panel,p.stake,p.auto_cashout);
      const left=p.remaining-1;
      await run("UPDATE sfa_auto_plans SET remaining=?,enabled=?,last_round=?,last_error='' WHERE id=?",left,left>0 ? 1 : 0,round.id,p.id);
    }
  }
  async function cashouts(round,current) {
    if(round.phase!=='FLYING')return;
    const bets=await q(`SELECT * FROM bets WHERE round_id=? AND status='ACTIVE'
      AND auto_cashout>=1.01 AND auto_cashout<=? AND auto_cashout<? ORDER BY id`,round.id,current,round.crash);
    for(const b of bets) {
      // Use the locked target, even if a delayed server tick has passed the crash time.
      // A target equal to the crash multiplier loses, matching cash-out-before-crash rules.
      const payout=Math.floor(b.stake*Math.round(b.auto_cashout*100)/100);
      const result=await run("UPDATE bets SET status='WON',payout=?,mult=? WHERE id=? AND status='ACTIVE'",payout,b.auto_cashout,b.id);
      if(result.changes)await credit(b.user_id,payout,'Demo cash out');
    }
  }
  return {placeManual,start,stop,stopAll,plans,place,cashouts};
}
