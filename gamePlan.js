// Server-only repeating plan.
// Empty boxes are skipped in numbered order.

export function normalizePlan(
  values,
  allowEmpty = false,
) {
  if (
    !Array.isArray(values) ||
    values.length > 50
  ) {
    throw new Error(
      "Use up to 50 multiplier boxes.",
    );
  }

  const slots = Array(50).fill(null);

  for (
    let index = 0;
    index < values.length;
    index++
  ) {
    const value = values[index];

    if (value === null) {
      continue;
    }

    if (
      !Number.isFinite(value) ||
      value < 1 ||
      value > 50 ||
      Math.abs(
        value * 100 -
          Math.round(value * 100),
      ) > 0.00001
    ) {
      throw new Error(
        `Box ${index + 1}: enter 1.00–50.00, with at most two decimals.`,
      );
    }

    slots[index] =
      Math.round(value * 100) / 100;
  }

  if (
    !allowEmpty &&
    !slots.some(
      (value) => value !== null,
    )
  ) {
    throw new Error(
      "Fill at least one multiplier box for Admin Control.",
    );
  }

  return slots;
}

export function savedPlan(settings) {
  let plan;

  try {
    plan = normalizePlan(
      JSON.parse(
        settings.adminPlan || "[]",
      ),
      true,
    );
  } catch {
    plan = Array(50).fill(null);
  }

  // Preserve the old single multiplier
  // when upgrading an existing installation.
  if (
    !plan.some(
      (value) => value !== null,
    ) &&
    !settings.adminPlan
  ) {
    const legacy = Number(
      settings.manualMultiplier,
    );

    plan[0] =
      Number.isFinite(legacy) &&
      legacy >= 1 &&
      legacy <= 50
        ? legacy
        : 2;
  }

  return plan;
}

export function takeAdminTarget(ctx) {
  return ctx.tx(() => {
    const settings = ctx.settings();

    const entries = savedPlan(settings)
      .map((value, index) => ({
        value,
        slot: index + 1,
      }))
      .filter(
        (entry) => entry.value !== null,
      );

    if (!entries.length) {
      return {
        value: 2,
        slot: null,
      };
    }

    const storedCursor = Number(
      settings.adminPlanCursor || 0,
    );

    const cursor =
      Number.isSafeInteger(
        storedCursor,
      ) &&
      storedCursor >= 0
        ? storedCursor % entries.length
        : 0;

    const entry = entries[cursor];

    ctx.run(
      `INSERT INTO settings(key,value)
       VALUES('adminPlanCursor',?)
       ON CONFLICT(key)
       DO UPDATE SET value=excluded.value`,
      String(
        (cursor + 1) % entries.length,
      ),
    );

    return entry;
  });
}
