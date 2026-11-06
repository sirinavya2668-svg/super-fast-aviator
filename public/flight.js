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
    Math.atan2(dy, dx) * 180 / Math.PI + 12;

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
  constructor(
    contextFactory = () => {
      const Audio =
        globalThis.AudioContext ||
        globalThis.webkitAudioContext;

      if (!Audio) {
        throw new Error(
          "Sound is not supported in this browser.",
        );
      }

      return new Audio();
    },
  ) {
    this.contextFactory = contextFactory;
    this.context = null;
    this.enabled = false;
    this.engine = null;
    this.lastPhase = "";
    this.lastCountdown = "";
    this.effects = new Set();
  }

  async toggle() {
    if (this.enabled) {
      this.enabled = false;
      this.reset();
      return false;
    }

    this.context ||=
      this.contextFactory();

    await this.context.resume();

    if (
      this.context.state !== "running"
    ) {
      throw new Error(
        "Tap Sound ON again to allow audio.",
      );
    }

    this.enabled = true;
    this.lastPhase = "";
    this.lastCountdown = "";

    return true;
  }

  tone(
    from,
    to,
    duration,
    volume = 0.06,
    delay = 0,
    type = "sine",
  ) {
    if (
      !this.enabled ||
      this.context?.state !== "running"
    ) {
      return;
    }

    const ctx = this.context;

    const start =
      ctx.currentTime + delay;

    const oscillator =
      ctx.createOscillator();

    const gain = ctx.createGain();

    oscillator.type = type;

    oscillator.frequency
      .setValueAtTime(
        from,
        start,
      );

    oscillator.frequency
      .exponentialRampToValueAtTime(
        Math.max(1, to),
        start + duration,
      );

    gain.gain.setValueAtTime(
      0.0001,
      start,
    );

    gain.gain
      .exponentialRampToValueAtTime(
        volume,
        start + 0.02,
      );

    gain.gain
      .exponentialRampToValueAtTime(
        0.0001,
        start + duration,
      );

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    this.effects.add(oscillator);

    oscillator.onended = () => {
      this.effects.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };

    oscillator.start(start);

    oscillator.stop(
      start + duration + 0.03,
    );
  }

  stopEngine() {
    if (!this.engine) {
      return;
    }

    try {
      this.engine.oscillator.stop();
    } catch {}

    this.engine.oscillator.disconnect();
    this.engine.gain.disconnect();

    this.engine = null;
  }

  reset() {
    this.stopEngine();

    for (
      const oscillator of this.effects
    ) {
      try {
        oscillator.stop();
      } catch {}
    }

    this.effects.clear();
    this.lastPhase = "";
    this.lastCountdown = "";
  }

  sync(round) {
    if (
      !this.enabled ||
      !round ||
      this.context?.state !== "running"
    ) {
      return;
    }

    const key =
      `${round.id}:${round.phase}`;

    const changed =
      key !== this.lastPhase;

    this.lastPhase = key;

    if (round.phase !== "FLYING") {
      this.stopEngine();
    }

    if (round.phase === "WAITING") {
      const countdownKey =
        `${round.id}:${round.countdown}`;

      if (
        round.countdown >= 1 &&
        round.countdown <= 3 &&
        countdownKey !==
          this.lastCountdown
      ) {
        this.tone(
          620,
          620,
          0.12,
          0.035,
        );
      }

      this.lastCountdown =
        countdownKey;
    } else if (
      round.phase === "FLYING"
    ) {
      if (changed) {
        this.tone(
          140,
          700,
          0.65,
          0.045,
          0,
          "triangle",
        );
      }

      if (!this.engine) {
        const oscillator =
          this.context.createOscillator();

        const gain =
          this.context.createGain();

        oscillator.type =
          "sawtooth";

        gain.gain.value = 0.025;

        oscillator.connect(gain);

        gain.connect(
          this.context.destination,
        );

        oscillator.start();

        this.engine = {
          oscillator,
          gain,
        };
      }

      const frequency =
        75 +
        Math.min(
          200,
          Math.max(
            0,
            Number(round.elapsedMs) || 0,
          ) / 150,
        );

      this.engine.oscillator.frequency
        .setTargetAtTime(
          frequency,
          this.context.currentTime,
          0.2,
        );
    } else if (
      round.phase === "CRASHED" &&
      changed
    ) {
      this.tone(
        200,
        30,
        0.6,
        0.065,
        0,
        "triangle",
      );
    }
  }

  cashout() {
    this.tone(
      660,
      660,
      0.16,
      0.05,
    );

    this.tone(
      880,
      880,
      0.2,
      0.05,
      0.14,
    );

    this.tone(
      1100,
      1100,
      0.3,
      0.045,
      0.3,
    );
  }
}
