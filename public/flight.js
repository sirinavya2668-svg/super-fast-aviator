// Flight movement follows the server clock.

export function flightPoint(elapsedMs = 0) {
  const elapsed = Number.isFinite(elapsedMs)
    ? Math.max(0, elapsedMs)
    : 0;

  const t = 1 - Math.exp(-elapsed / 7000);

  const start = { x: 70, y: 215 };
  const control = { x: 280, y: 195 };
  const end = { x: 520, y: 45 };

  const inverse = 1 - t;

  const x =
    inverse * inverse * start.x +
    2 * inverse * t * control.x +
    t * t * end.x;

  const y =
    inverse * inverse * start.y +
    2 * inverse * t * control.y +
    t * t * end.y;

  const dx =
    2 * (
      inverse * (control.x - start.x) +
      t * (end.x - control.x)
    );

  const dy =
    2 * (
      inverse * (control.y - start.y) +
      t * (end.y - control.y)
    );

  const angle =
    Math.atan2(dy, dx) * 180 / Math.PI;

  const partialX =
    start.x + (control.x - start.x) * t;

  const partialY =
    start.y + (control.y - start.y) * t;

  return {
    x,
    y,
    angle,

    path:
      `M ${start.x} ${start.y} ` +
      `Q ${partialX.toFixed(2)} ${partialY.toFixed(2)} ` +
      `${x.toFixed(2)} ${y.toFixed(2)}`,
  };
}

export function elapsedAt(
  snapshot,
  receivedAt,
  now,
) {
  if (
    !snapshot ||
    snapshot.phase === "WAITING"
  ) {
    return 0;
  }

  const baseline = Math.max(
    0,
    Number(snapshot.elapsedMs) || 0,
  );

  if (snapshot.phase !== "FLYING") {
    return baseline;
  }

  return (
    baseline +
    Math.min(
      2000,
      Math.max(0, now - receivedAt),
    )
  );
}

// Optional sound, enabled by tapping Sound ON.

export class GameAudio {
  constructor(factory=()=>new Audio('/game-music.mp3?v=20261114-track')) {
    this.factory=factory;this.music=null;this.enabled=false;this.pending=null;this.blocked=false;this.generation=0;
  }
  player() {
    if(!this.music){this.music=this.factory();this.music.loop=true;this.music.volume=0.55;this.music.preload='none';}
    return this.music;
  }
  async toggle() {
    if(this.pending)return this.pending;
    if(this.enabled){this.enabled=false;this.reset();return false;}
    const music=this.player(),generation=this.generation;
    this.pending=(async()=>{
      try {
        await music.play();
        if(generation!==this.generation){music.pause();return false;}
        this.enabled=true;this.blocked=false;return true;
      }catch{this.enabled=false;throw new Error('Music could not start. Check game-music.mp3, then tap Sound ON again.');}
      finally{this.pending=null;}
    })();
    return this.pending;
  }
  stopEngine(){this.generation++;this.music?.pause();}
  reset(){this.stopEngine();if(this.music){try{this.music.currentTime=0;}catch{}}this.blocked=false;}
  sync(round) {
    if(!this.enabled || !round || this.blocked || this.pending)return;
    const music=this.player();
    if(music.paused){
      const generation=this.generation;
      try{this.pending=Promise.resolve(music.play()).then(()=>{if(generation!==this.generation)music.pause();}).catch(error=>{if(error?.name!=='AbortError')this.blocked=true;}).finally(()=>{this.pending=null;});}
      catch{this.blocked=true;}
    }
  }
  tone(){} // No old generated beeps: the supplied recording is the game sound.
  cashout(){}
}
