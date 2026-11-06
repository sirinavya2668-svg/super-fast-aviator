// Optional one-time import from an existing trusted SQLite backup.
// Runs only when SQLITE_IMPORT_PATH is configured.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

const tables = [
  "users",
  "settings",
  "rounds",
  "bets",
  "ledger",
  "requests",
  "claims",
  "media",
  "audit",
  "manual_bonus_credits",
  "sfa_runtime",
];

export async function importSqliteBackup(ctx, filename) {
  if (!fs.existsSync(filename)) {
    throw new Error(
      "SQLITE_IMPORT_PATH does not exist. Import stopped."
    );
  }

  const source = new DatabaseSync(filename, {
    readOnly: true,
  });

  try {
    const available = new Set(
      source
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table'"
        )
        .all()
        .map(row => row.name)
    );

    if (!available.has("users")) {
      throw new Error(
        "The import file is not an Aviator SQLite backup."
      );
    }

    await ctx.gameTransaction(async () => {
      const imported = await ctx.one(
        "SELECT body FROM sfa_runtime WHERE key='sqlite_import_complete'"
      );

      if (imported) {
        return;
      }

      for (const table of [
        "bets",
        "ledger",
        "requests",
        "claims",
        "media",
        "manual_bonus_credits",
        "rounds",
      ]) {
        const count = await ctx.one(
          `SELECT COUNT(*) n FROM ${table}`
        );

        if (count.n > 0) {
          throw new Error(
            "Import requires an unused PostgreSQL database. Existing records were not changed."
          );
        }
      }

      const customers = await ctx.one(
        "SELECT COUNT(*) n FROM users WHERE role='customer'"
      );

      if (customers.n > 0) {
        throw new Error(
          "Import requires an unused PostgreSQL database. Existing customer IDs were not changed."
        );
      }

      const defaults = await ctx.q(
        "SELECT * FROM settings"
      );

      for (const table of [...tables].reverse()) {
        await ctx.run(`DELETE FROM ${table}`);
      }

      for (const table of tables) {
        if (!available.has(table)) {
          continue;
        }

        const schema = await ctx.q(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema=current_schema()
           AND table_name=?`,
          table
        );

        const allowed = new Set(
          schema.map(row => row.column_name)
        );

        const rows = source
          .prepare(`SELECT * FROM ${table}`)
          .all();

        for (const row of rows) {
          const columns = Object.keys(row);

          if (columns.some(name => !allowed.has(name))) {
            throw new Error(
              "Unsupported backup schema for " +
                table +
                ". Import rolled back."
            );
          }

          const placeholders = columns
            .map(() => "?")
            .join(",");

          await ctx.run(
            `INSERT INTO ${table}(${columns.join(",")})
             VALUES(${placeholders})`,
            ...columns.map(key => row[key])
          );
        }
      }

      for (const row of defaults) {
        await ctx.run(
          "INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)",
          row.key,
          row.value
        );
      }

      const sequenceTables = tables.filter(
        name =>
          ![
            "settings",
            "media",
            "sfa_runtime",
            "claims",
          ].includes(name)
      );

      for (const table of sequenceTables) {
        await ctx.q(`
          SELECT setval(
            pg_get_serial_sequence('${table}','id'),
            GREATEST(
              COALESCE(
                (SELECT MAX(id) FROM ${table}),
                0
              ),
              1
            ),
            EXISTS(SELECT 1 FROM ${table})
          )
        `);
      }

      // Older backups may not contain a persisted live round.
      const savedRound = await ctx.one(
        "SELECT body FROM sfa_runtime WHERE key='round'"
      );

      if (!savedRound) {
        const activeBets = await ctx.q(
          "SELECT * FROM bets WHERE status='ACTIVE'"
        );

        for (const bet of activeBets) {
          await ctx.credit(
            bet.user_id,
            bet.stake,
            "Interrupted migration refund"
          );

          await ctx.run(
            "UPDATE bets SET status='VOID' WHERE id=?",
            bet.id
          );
        }
      }

      const admin = await ctx.one(
        "SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1"
      );

      if (!admin) {
        throw new Error(
          "SQLite backup has no administrator. Import rolled back."
        );
      }

      await ctx.run(
        "UPDATE users SET username=?,password=? WHERE id=?",
        ctx.adminName,
        ctx.hash(ctx.adminPassword),
        admin.id
      );

      await ctx.run(
        "INSERT INTO sfa_runtime(key,body) VALUES('sqlite_import_complete',?)",
        JSON.stringify({
          completedAt: new Date().toISOString(),
        })
      );
    });
  } finally {
    source.close();
  }
}
