// Flight animation follows the server round timing.
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

export function elapsedAt(snapshot, receivedAt, now) {
  if (!snapshot || snapshot.phase === "WAITING") {
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
    Math.min(2000, Math.max(0, now - receivedAt))
  );
}
