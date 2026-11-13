// Admin notifications only. No pages or API responses are cached.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let data={};
    try { data=event.data?.json() || {}; } catch { /* Use generic alert. */ }
    const payload={
      eventKey:String(data.eventKey || 'admin-alert'),
      title:String(data.title || 'Super Fast Aviator · Admin alert'),
      body:String(data.body || 'Open Admin to review new activity.'),
    };
    await self.registration.showNotification(payload.title,{
      body:payload.body,tag:payload.eventKey,renotify:false,
      silent:false,vibrate:[250,100,250],data:{url:'/admin'},
    });
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const admins=clients.filter(client=>new URL(client.url).pathname.replace(/\/$/,'')==='/admin');
    const target=admins.find(client=>client.focused) || admins[0];
    target?.postMessage({type:'SFA_ADMIN_ALERT',...payload});
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients){
      if(new URL(client.url).pathname.replace(/\/$/,'')==='/admin'){await client.focus();return;}
    }
    await self.clients.openWindow('/admin');
  })());
});
