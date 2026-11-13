export class AdminAlerts {
  constructor({api,toast}) {
    this.api=api;this.toast=toast;this.user=null;this.enabled=false;this.audio=null;this.busy=false;this.seen=new Set();this.alarmNodes=[];this.alarmBuffer=null;
    document.addEventListener('click',e=>{
      const button=e.target.closest('[data-admin-alerts]');
      if(!button || button.disabled)return;
      if(button.dataset.adminAlerts==='enable')this.enable();
      else if(button.dataset.adminAlerts==='test')this.test();
      else if(button.dataset.adminAlerts==='off')this.disable();
      else if(button.dataset.adminAlerts==='stop')this.stopAlarm();
    });
    navigator.serviceWorker?.addEventListener('message',e=>{
      if(e.data?.type==='SFA_ADMIN_ALERT' && this.user?.role==='admin' && !this.seen.has(e.data.eventKey)) {
        this.seen.add(e.data.eventKey);if(this.seen.size>200)this.seen.delete(this.seen.values().next().value);
        this.chime();this.toast(String(e.data.body || 'New admin alert received.'));
        const banner=document.querySelector('#newrequest');
        if(banner){banner.hidden=false;banner.textContent='New activity received — Refresh to view';}
      }
    });
  }
  setAccount(user) { this.user=user;if(!user)this.stopAlarm(); }
  mount(user) {
    this.user=user;
    const header=document.querySelector('.adminmain > header');
    if(!header || document.querySelector('#adminalerttools'))return;
    const tools=document.createElement('div');tools.id='adminalerttools';
    tools.innerHTML='<button class="green mini" data-admin-alerts="enable">ENABLE ARMY ALARM</button> <button class="outline mini" data-admin-alerts="test">TEST ALERT</button> <button class="wine mini" data-admin-alerts="stop">STOP ALARM</button> <button class="mini" data-admin-alerts="off">ALERTS OFF</button><small class="muted" id="adminalertstatus">Enable alerts on this device.</small>';
    header.append(tools);this.status();this.restore();
  }
  status(message) {
    const el=document.querySelector('#adminalertstatus');
    if(el)el.textContent=message || (this.enabled ? 'Push alerts ON · Tap Enable after reopening to activate in-page sound.' : 'Enable alerts on this device.');
    for(const b of document.querySelectorAll('[data-admin-alerts]'))b.disabled=b.dataset.adminAlerts==='stop' ? false : this.busy;
  }
  async registration() {
    const reg=await navigator.serviceWorker.register('/admin-sw.js',{scope:'/admin',updateViaCache:'none'});
    if(reg.active)return reg;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Notification worker is not ready. Please retry.')),12000);
      const check=()=>{if(reg.active){clearTimeout(timeout);resolve(reg);}};
      reg.addEventListener('updatefound',()=>{reg.installing?.addEventListener('statechange',check);check();});
      reg.installing?.addEventListener('statechange',check);reg.waiting?.addEventListener('statechange',check);check();
    });
  }
  async restore() {
    if(!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission!=='granted')return;
    try {
      const reg=await navigator.serviceWorker.getRegistration('/admin');
      this.enabled=!!(await reg?.pushManager.getSubscription());this.status();
    }catch{this.enabled=false;this.status();}
  }
  async enable() {
    if(this.busy || this.user?.role!=='admin')return;
    if(!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      this.toast('Open the HTTPS admin link in a browser that supports push notifications.');return;
    }
    this.busy=true;this.status('Enabling alerts…');
    try {
      const Audio=window.AudioContext || window.webkitAudioContext;
      if(Audio){this.audio ||= new Audio();this.audio.resume().catch(()=>{});}
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw new Error('Allow notifications in browser/site settings, then tap Enable again.');
      await this.loadAlarm();
      const reg=await this.registration(),config=await this.api('admin/push-config');
      const key=this.decode(config.publicKey);
      let sub=await reg.pushManager.getSubscription();
      if(sub && !this.sameKey(sub.options.applicationServerKey,key)){await sub.unsubscribe();sub=null;}
      sub ||= await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      await this.api('admin/push-subscribe',{subscription:sub.toJSON()});
      this.enabled=true;this.chime(true);this.toast('Army alarm enabled. Tap TEST ALERT to check the notification banner.');
    }catch(error){this.toast(error.message);}
    finally{this.busy=false;this.status();}
  }
  decode(s) {
    const value=String(s).replace(/-/g,'+').replace(/_/g,'/');
    return Uint8Array.from(atob(value+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
  }
  sameKey(a,b) { const v=new Uint8Array(a || []);return v.length===b.length&&v.every((x,i)=>x===b[i]); }
  async test() {
    if(this.busy)return;this.busy=true;this.status('Sending test alert…');
    try {
      const reg=await navigator.serviceWorker.getRegistration('/admin'),sub=await reg?.pushManager.getSubscription();
      if(!sub || !this.enabled)throw new Error('Tap ENABLE ARMY ALARM first.');
      await this.api('admin/push-test',{endpoint:sub.endpoint});this.toast('Test alert queued. Allow a few seconds.');
    }catch(error){this.toast(error.message);}
    finally{this.busy=false;this.status();}
  }
  async disable({quiet=false}={}) {
    this.stopAlarm();
    if(this.busy && !quiet)return;
    this.busy=true;this.status('Disabling alerts…');let failed=false;
    try {
      const reg=await navigator.serviceWorker?.getRegistration('/admin'),sub=await reg?.pushManager.getSubscription();
      if(sub){
        try{await this.api('admin/push-unsubscribe',{endpoint:sub.endpoint});}
        finally{const removed=await sub.unsubscribe();if(!removed)throw new Error('Could not disable the device subscription. Please retry.');}
      }
      this.enabled=false;
    }catch(error){failed=true;if(!quiet)this.toast(error.message);}
    finally{this.busy=false;this.status();}
    if(!failed&&!quiet)this.toast('Admin alerts turned off on this device.');
  }
  stopAlarm() {
    for(const node of this.alarmNodes){try{node.stop();}catch{}try{node.disconnect();}catch{}}
    this.alarmNodes=[];
  }
  async loadAlarm() {
    if(this.alarmBuffer)return;
    if(!this.audio)throw new Error('This browser does not support the alarm audio.');
    const response=await fetch('/army_alert_alarm.mp3?v=20261113-original',{cache:'no-store'});
    if(!response.ok)throw new Error('Upload army_alert_alarm.mp3 to the public folder, then retry.');
    this.alarmBuffer=await this.audio.decodeAudioData(await response.arrayBuffer());
  }
  chime(preview=false) {
    if(!this.audio || this.audio.state!=='running' || !this.alarmBuffer)return;
    this.stopAlarm();
    try{
      const source=this.audio.createBufferSource(),gain=this.audio.createGain();
      source.buffer=this.alarmBuffer;gain.gain.value=1;
      source.connect(gain);gain.connect(this.audio.destination);this.alarmNodes=[source,gain];
      source.onended=()=>{source.disconnect();gain.disconnect();if(this.alarmNodes[0]===source)this.alarmNodes=[];};
      source.start(0,0,preview ? Math.min(1.2,this.alarmBuffer.duration) : this.alarmBuffer.duration);
    }catch{/* Device controls sound availability. */}
  }
}
