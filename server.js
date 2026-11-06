import { takeAdminTarget } from "./gamePlan.js";
import { createAdminFeatures } from "./adminFeatures.js";
import http from "node:http";
import { openDatabase } from "./database.js";
import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const { db, q, one, run, tx, gameTransaction, closeDatabase } = await openDatabase();

(await db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;

  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'customer',
    balance INTEGER DEFAULT 0,
    blocked INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS requests(
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    type TEXT,
    amount INTEGER,
    status TEXT DEFAULT 'PENDING',
    note TEXT,
    created TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rounds(
    id INTEGER PRIMARY KEY,
    mult REAL,
    created TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bets(
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    round_id INTEGER,
    panel INTEGER,
    stake INTEGER,
    status TEXT DEFAULT 'ACTIVE',
    payout INTEGER DEFAULT 0,
    mult REAL DEFAULT 0,
    UNIQUE(user_id, round_id, panel)
  );

  CREATE TABLE IF NOT EXISTS ledger(
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    amount INTEGER,
    note TEXT,
    created TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS claims(
    user_id INTEGER,
    code TEXT,
    UNIQUE(user_id, code)
  );
`));

function hash(password) {
  const salt =
    randomBytes(16).toString("hex");

  const value = scryptSync(
    password,
    salt,
    64,
  ).toString("hex");

  return salt + ":" + value;
}

function valid(password, stored) {
  const [salt, value] =
    stored.split(":");

  return timingSafeEqual(
    Buffer.from(value, "hex"),
    scryptSync(password, salt, 64),
  );
}

const adminPassword =
  process.env.ADMIN_PASSWORD;

if (
  !adminPassword ||
  adminPassword.length < 12 ||
  adminPassword.length > 128
) {
  throw new Error(
    "Set ADMIN_PASSWORD to a unique password of 12–128 characters.",
  );
}

const adminName =
  process.env.ADMIN_USERNAME ||
  "admin";

const existingAdmin = (await one(
  "SELECT * FROM users WHERE role='admin'",
));

if (!existingAdmin) {
  (await run(
    `INSERT INTO users(
      username,
      password,
      role
    ) VALUES(?,?,'admin')`,
    adminName,
    hash(adminPassword),
  ));
} else {
  (await run(
    `UPDATE users
     SET username=?,
         password=?
     WHERE id=?`,
    adminName,
    hash(adminPassword),
    existingAdmin.id,
  ));
}

const defaultSettings = {
  gameMode: "RANDOM",
  manualMultiplier: "2.00",
  welcome: 10,
  promo: 10,
  losing: 10,
  promoCode: "SUPER10",

  rules:
    "Simulation balance only. Amounts use the ₹ symbol for display. " +
    "Place a bet during the countdown. " +
    "Cash out before the plane flies away. " +
    "If it flies away first, your stake is lost. " +
    "Each round is randomly simulated on the server. " +
    "Welcome, promo and losing bonuses are added only by the administrator. " +
    "No bonus is credited automatically. Losing bonus requires admin review of losses of ₹10,000 or more.",

  support: "",
};

for (
  const [key, value]
  of Object.entries(defaultSettings)
) {
  (await run(
    "INSERT OR IGNORE INTO settings VALUES(?,?)",
    key,
    String(value),
  ));
}

async function settings() {
  return Object.fromEntries(
    (await q("SELECT * FROM settings")).map(
      (item) => [
        item.key,
        item.value,
      ],
    ),
  );
}

async function credit(userId, coins, note) {
  (await run(
    `UPDATE users
     SET balance=balance+?
     WHERE id=?`,
    coins,
    userId,
  ));

  (await run(
    `INSERT INTO ledger(
      user_id,
      amount,
      note
    ) VALUES(?,?,?)`,
    userId,
    coins,
    note,
  ));
}

// Active rounds and stakes are preserved in PostgreSQL across restarts.
async function buildRound(id) {
  const currentSettings = (await settings());

  const mode =
    ["ADMIN", "ADMIN2"].includes(currentSettings.gameMode)
      ? currentSettings.gameMode
      : "RANDOM";

  // One plan entry per new countdown.
  // Current waiting/flying rounds stay locked.
  const target =
    mode !== "RANDOM"
      ? (await takeAdminTarget({
          settings,
          run,
          tx,
        }, mode === "ADMIN2" ? "02" : "01"))
      : {
          value: 2,
          slot: null,
        };

  return {
    id,
    phase: "WAITING",

    // Betting window: 10 seconds.
    start: Date.now() + 10000,

    end: 0,
    crash: 1,
    mode,
    fixed: target.value,
    planSlot: target.slot,
  };
}

let round = null;

function begin() {
  round.phase = "FLYING";
  round.start = Date.now();

  if (["ADMIN", "ADMIN2"].includes(round.mode)) {
    round.crash = round.fixed;
  } else {
    const randomValue =
      randomInt(0, 1000000) /
      1000000;

    round.crash = Math.min(
      50,
      Math.max(
        1,
        Math.floor(
          (0.97 / (1 - randomValue)) *
            100,
        ) / 100,
      ),
    );
  }
}

function multiplier() {
  if (round.phase !== "FLYING") {
    return 1;
  }

  const seconds =
    (Date.now() - round.start) /
    1000;

  return (
    Math.floor(
      Math.exp(seconds * 0.16) *
        100,
    ) / 100
  );
}

async function advance() {
  if (
    round.phase === "WAITING" &&
    Date.now() >= round.start
  ) {
    begin();
  }

  if (
    round.phase === "FLYING" &&
    multiplier() >= round.crash
  ) {
    (await tx(async () => {
      (await run(
        `INSERT INTO rounds(
          id,
          mult,
          mode
        ) VALUES(?,?,?)`,
        round.id,
        round.crash,
        round.mode,
      ));

      const activeBets = (await q(
        `SELECT *
         FROM bets
         WHERE round_id=?
         AND status='ACTIVE'`,
        round.id,
      ));

      for (const bet of activeBets) {
        (await run(
          "UPDATE bets SET status='LOST' WHERE id=?",
          bet.id,
        ));


      }
    }));

    round.phase = "CRASHED";
    round.end = Date.now() + 3500;
  }

  if (
    round.phase === "CRASHED" &&
    Date.now() >= round.end
  ) {
    round = (await buildRound(
      round.id + 1,
    ));
  }
}

const sessions = new Map();
const limits = new Map();

setInterval(() => {
  const now = Date.now();

  for (
    const [token, session]
    of sessions
  ) {
    if (session.exp < now) {
      sessions.delete(token);
    }
  }

  for (
    const [key, limit]
    of limits
  ) {
    if (limit.exp < now) {
      limits.delete(key);
    }
  }
}, 60000).unref();

function fail(
  message,
  status = 400,
) {
  throw Object.assign(
    new Error(message),
    { status },
  );
}

function amount(
  value,
  minimum = 100,
) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > 25000
  ) {
    fail(
      `Enter a whole amount from ₹${minimum} to ₹25,000.`,
    );
  }

  return value;
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    balance: user.balance,
    blocked: user.blocked,
    fullName: user.full_name,
    promoCode: user.role === "customer" ? user.promo_code || "" : undefined,
    mustChangePassword:
      !!user.must_change,
  };
}

async function body(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > 2400000) {
      fail(
        "Request too large",
        413,
      );
    }

    chunks.push(chunk);
  }

  let value;

  try {
    value = JSON.parse(
      Buffer.concat(chunks)
        .toString("utf8") ||
        "{}",
    );
  } catch {
    fail("Invalid JSON");
  }

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(
      "JSON object required.",
    );
  }

  return value;
}

const features =
  (await createAdminFeatures({
    db,
    q,
    one,
    run,
    tx,
    hash,
    valid,
    credit,
    settings,
    sessions,
    fail,
    amount,

    getGame: () => ({
      id: round.id,
      phase: round.phase,
      mode: round.mode,
      planSlot: round.planSlot,

      mult:
        round.phase === "CRASHED"
          ? round.crash
          : multiplier(),
    }),
  }));

if (process.env.SQLITE_IMPORT_PATH) {
  const {importSqliteBackup} = await import("./importSqlite.js");
  await importSqliteBackup({q,one,run,gameTransaction,credit,hash,adminName,adminPassword},process.env.SQLITE_IMPORT_PATH);
}

async function withGame(callback = async () => {}) {
  return gameTransaction(async () => {
    const saved = await one("SELECT body FROM sfa_runtime WHERE key='round'");
    if (saved) {
      round = JSON.parse(saved.body);
      if (!Number.isSafeInteger(round.id) || !["WAITING", "FLYING", "CRASHED"].includes(round.phase)) {
        throw new Error("Stored round is invalid; refusing to reset game data.");
      }
    } else {
      const row = await one(`SELECT GREATEST(
        COALESCE((SELECT MAX(id) FROM rounds),0),
        COALESCE((SELECT MAX(round_id) FROM bets),0)
      )+1 n`);
      round = await buildRound(Number(row.n));
    }
    await advance();
    const result = await callback();
    const body = JSON.stringify(round);
    if (body !== saved?.body) {
      await run("INSERT INTO sfa_runtime(key,body) VALUES('round',?) ON CONFLICT(key) DO UPDATE SET body=excluded.body", body);
    }
    return result;
  });
}

await withGame();
let ticking = false;
const roundTimer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try { await withGame(); }
  catch (error) { console.error("Round storage unavailable:", error.code || "database error"); }
  finally { ticking = false; }
}, 100);
roundTimer.unref();

const server = http.createServer(
  async (req, res) => {
    res.setHeader(
      "X-Content-Type-Options",
      "nosniff",
    );

    res.setHeader(
      "Referrer-Policy",
      "same-origin",
    );

    res.setHeader(
      "X-Frame-Options",
      "DENY",
    );

    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self'; " +
        "img-src 'self' data:; " +
        "connect-src 'self'; " +
        "object-src 'none'; " +
        "frame-ancestors 'none'; " +
        "base-uri 'none'; " +
        "form-action 'self'",
    );

    try {
      const url = new URL(
        req.url,
        "http://localhost",
      );

      const route = url.pathname;

      if (route === "/health") {
        await one("SELECT 1 AS healthy");
        res.end("ok");
        return;
      }

      if (
        !route.startsWith("/api/")
      ) {
        const files = {
          "/": "index.html",
          "/admin": "admin.html",
          "/admin/": "admin.html",
          "/admin.js": "admin.js",
          "/app.js": "app.js",
          "/flight.js": "flight.js",
          "/style.css": "style.css",
          "/plane.svg": "plane.svg",
        };

        const file = files[route];

        if (!file) {
          fail("Not found", 404);
        }

        let contentType =
          "text/html";

        if (
          file.endsWith(".js")
        ) {
          contentType =
            "text/javascript";
        } else if (
          file.endsWith(".css")
        ) {
          contentType =
            "text/css";
        } else if (
          file.endsWith(".svg")
        ) {
          contentType =
            "image/svg+xml";
        }

        res.setHeader(
          "Content-Type",
          contentType,
        );

        res.end(
          fs.readFileSync(
            new URL(
              "./public/" + file,
              import.meta.url,
            ),
          ),
        );

        return;
      }

      res.setHeader(
        "Content-Type",
        "application/json",
      );

      res.setHeader(
        "Cache-Control",
        "no-store",
      );

      const post =
        req.method === "POST";

      if (
        !["GET", "POST"].includes(
          req.method,
        )
      ) {
        fail(
          "Method not allowed",
          405,
        );
      }

      if (post) {
        const origin =
          req.headers.origin;

        if (
          origin &&
          origin !==
            `https://${req.headers.host}` &&
          origin !==
            `http://${req.headers.host}`
        ) {
          fail(
            "Invalid origin",
            403,
          );
        }

        const contentType =
          req.headers[
            "content-type"
          ] || "";

        if (
          !contentType.startsWith(
            "application/json",
          )
        ) {
          fail(
            "JSON required",
            415,
          );
        }
      }

      const data = post
        ? await body(req)
        : {};

      let reply;
      await withGame(async () => {
        const originalEnd = res.end;
        res.end = function (value) { reply = value; return res; };
        try {

      const adminPortal =
        route.startsWith(
          "/api/admin/",
        ) ||
        url.searchParams.get(
          "portal",
        ) === "admin" ||
        data.admin === true;

      const cookieName =
        adminPortal
          ? "sfa_admin_session"
          : "sfa_session";

      const cookies =
        Object.fromEntries(
          (
            req.headers.cookie ||
            ""
          )
            .split(";")
            .map((item) =>
              item
                .trim()
                .split("="),
            ),
        );

      let token =
        cookies[cookieName];

      const session =
        sessions.get(token);

      let user =
        session &&
        session.exp > Date.now()
          ? (await one(
              `SELECT *
               FROM users
               WHERE id=?`,
              session.id,
            ))
          : null;

      if (user?.blocked) {
        user = null;
      }

      if (
        route.startsWith(
          "/api/media/",
        ) &&
        !post
      ) {
        const adminSession =
          sessions.get(
            cookies.sfa_admin_session,
          );

        const adminUser =
          adminSession &&
          adminSession.exp >
            Date.now()
            ? (await one(
                `SELECT *
                 FROM users
                 WHERE id=?
                 AND role='admin'
                 AND blocked=0`,
                adminSession.id,
              ))
            : null;

        const file =
          (await features.media(
            route.slice(
              "/api/media/".length,
            ),
            adminUser || user,
          ));

        res.setHeader(
          "Content-Type",
          file.mime,
        );

        res.setHeader(
          "Content-Disposition",
          "inline",
        );

        res.end(
          Buffer.from(file.bytes),
        );

        return;
      }

      let output = {};

      if (
        route === "/api/public" &&
        !post
      ) {
        const {
          manualMultiplier,
          adminPlan,
          adminPlanCursor,
          adminPlan2,
          adminPlanCursor2,
          promoCode: legacyPromoCode,
          ...publicSettings
        } = (await settings());

        output = publicSettings;
      } else if (
        [
          "/api/login",
          "/api/signup",
          "/api/admin/login",
        ].includes(route) &&
        post
      ) {
        const ip =
          req.socket.remoteAddress;

        const key =
          ip +
          "|" +
          String(
            data.username || "",
          )
            .toLowerCase()
            .slice(0, 30);

        const limit =
          limits.get(key) || {
            n: 0,
            exp:
              Date.now() +
              900000,
          };

        limit.n += 1;

        if (limit.n > 30) {
          fail(
            "Too many attempts. Try again in 15 minutes.",
            429,
          );
        }

        limits.set(key, limit);

        const username = String(
          data.username || "",
        )
          .toLowerCase()
          .trim();

        const password = String(
          data.password || "",
        );

        if (
          !/^[a-z0-9._-]{4,30}$/.test(
            username,
          ) ||
          password.length < 8 ||
          password.length > 128
        ) {
          fail(
            "Username: 4–30 letters/numbers. Password: 8–128 characters.",
          );
        }

        if (
          route === "/api/signup"
        ) {
          const exists = (await one(
            `SELECT id
             FROM users
             WHERE username=?`,
            username,
          ));

          if (exists) {
            fail(
              "Username already exists.",
            );
          }

          (await run(
            `INSERT INTO users(
              username,
              password
            ) VALUES(?,?)`,
            username,
            hash(password),
          ));
        }

        const foundUser = (await one(
          `SELECT *
           FROM users
           WHERE username=?`,
          username,
        ));

        if (
          !foundUser ||
          !valid(
            password,
            foundUser.password,
          ) ||
          foundUser.blocked
        ) {
          fail(
            "Invalid login or blocked account.",
            401,
          );
        }

        if (
          adminPortal &&
          foundUser.role !==
            "admin"
        ) {
          fail(
            "Admin account required",
            403,
          );
        }

        if (
          !adminPortal &&
          foundUser.role !==
            "customer"
        ) {
          fail(
            "Use /admin for administrator login.",
            403,
          );
        }

        token = randomBytes(
          32,
        ).toString("hex");

        sessions.set(token, {
          id: foundUser.id,

          exp:
            Date.now() +
            8 * 3600000,
        });

        const secure =
          process.env.NODE_ENV ===
          "production"
            ? "; Secure"
            : "";

        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`,
        );

        output = {
          user:
            safeUser(foundUser),
        };
      } else if (
        [
          "/api/logout",
          "/api/admin/logout",
        ].includes(route) &&
        post
      ) {
        sessions.delete(token);

        res.setHeader(
          "Set-Cookie",
          `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
        );
      } else if (
        route === "/api/me" &&
        !post
      ) {
        output = {
          user: user
            ? safeUser(user)
            : null,
        };
      } else {
        if (!user) {
          fail(
            "Please log in.",
            401,
          );
        }

        if (
          route.startsWith(
            "/api/admin/",
          )
        ) {
          if (
            user.role !== "admin"
          ) {
            fail(
              "Admin access required",
              403,
            );
          }

          output =
            (await features.admin(
              route,
              post,
              data,
              url,
              user,
            ));
        } else {
          if (
            user.role !==
            "customer"
          ) {
            fail(
              "Customer account required",
              403,
            );
          }

          if (
            user.must_change &&
            route !==
              "/api/password"
          ) {
            fail(
              "Change your temporary password first.",
              428,
            );
          }

          (await advance());

          if (
            route ===
              "/api/state" &&
            !post
          ) {
            output = {
              user: safeUser(
                (await one(
                  `SELECT *
                   FROM users
                   WHERE id=?`,
                  user.id,
                )),
              ),

              round: {
                id: round.id,
                phase: round.phase,
                mode: round.mode,

                mult:
                  round.phase ===
                  "CRASHED"
                    ? round.crash
                    : multiplier(),

                elapsedMs:
                  round.phase ===
                  "WAITING"
                    ? 0
                    : round.phase ===
                        "FLYING"
                      ? Math.max(
                          0,
                          Date.now() -
                            round.start,
                        )
                      : Math.max(
                          0,
                          (Math.log(
                            round.crash,
                          ) /
                            0.16) *
                            1000,
                        ),

                countdown:
                  Math.max(
                    0,
                    Math.ceil(
                      (
                        round.start -
                        Date.now()
                      ) / 1000,
                    ),
                  ),
              },

              history: (await q(`
                SELECT *
                FROM rounds
                ORDER BY id DESC
                LIMIT 12
              `)),

              bets: (await q(
                `SELECT *
                 FROM bets
                 WHERE user_id=?
                 ORDER BY id DESC
                 LIMIT 30`,
                user.id,
              )),

              allBets: (await q(
                `SELECT
                   b.stake,
                   b.status,
                   b.mult,
                   b.payout,
                   u.username
                 FROM bets b
                 JOIN users u
                   ON u.id=b.user_id
                 WHERE round_id=?
                 ORDER BY b.id DESC
                 LIMIT 50`,
                round.id,
              )),
            };
          } else if (
            route === "/api/bet" &&
            post
          ) {
            if (
              round.phase !==
                "WAITING" ||
              data.roundId !==
                round.id
            ) {
              fail(
                "Betting closed. Wait for the next round.",
              );
            }

            const stake = amount(
              data.amount,
              10,
            );

            if (
              ![1, 2].includes(
                data.panel,
              )
            ) {
              fail(
                "Invalid bet panel",
              );
            }

            (await tx(async () => {
              const duplicate =
                (await one(
                  `SELECT id
                   FROM bets
                   WHERE user_id=?
                   AND round_id=?
                   AND panel=?`,
                  user.id,
                  round.id,
                  data.panel,
                ));

              if (duplicate) {
                fail(
                  "Only one bet per panel per round.",
                );
              }

              const balance =
                (await one(
                  `SELECT balance
                   FROM users
                   WHERE id=?`,
                  user.id,
                )).balance;

              if (
                balance < stake
              ) {
                fail(
                  "Insufficient balance.",
                );
              }

              (await credit(
                user.id,
                -stake,
                "Demo stake",
              ));

              (await run(
                `INSERT INTO bets(
                  user_id,
                  round_id,
                  panel,
                  stake
                ) VALUES(?,?,?,?)`,
                user.id,
                round.id,
                data.panel,
                stake,
              ));
            }));
          } else if (
            route ===
              "/api/cashout" &&
            post
          ) {
            (await advance());

            if (
              round.phase !==
              "FLYING"
            ) {
              fail(
                "Cash out unavailable.",
              );
            }

            (await tx(async () => {
              const bet = (await one(
                `SELECT *
                 FROM bets
                 WHERE id=?
                 AND user_id=?
                 AND round_id=?
                 AND status='ACTIVE'`,
                Number(data.id),
                user.id,
                round.id,
              ));

              if (!bet) {
                fail(
                  "Bet already settled or missing.",
                );
              }

              const current =
                multiplier();

              if (
                current >=
                round.crash
              ) {
                fail(
                  "Round ended.",
                );
              }

              const payout =
                Math.floor(
                  bet.stake *
                    current,
                );

              (await run(
                `UPDATE bets
                 SET status='WON',
                     payout=?,
                     mult=?
                 WHERE id=?`,
                payout,
                current,
                bet.id,
              ));

              (await credit(
                user.id,
                payout,
                "Demo cash out",
              ));
            }));
          } else if (
            route ===
              "/api/request" &&
            post
          ) {
            output =
              (await features.customerRequest(
                data,
                user,
              ));
          } else if (
            route ===
              "/api/password" &&
            post
          ) {
            output =
              (await features.changePassword(
                data,
                user,
              ));
          } else if (
            route ===
              "/api/account" &&
            !post
          ) {
            output = {
              requests: (await q(
                `SELECT *
                 FROM requests
                 WHERE user_id=?
                 ORDER BY id DESC
                 LIMIT 30`,
                user.id,
              )),

              ledger: (await q(
                `SELECT *
                 FROM ledger
                 WHERE user_id=?
                 ORDER BY id DESC
                 LIMIT 50`,
                user.id,
              )),
            };
          } else if (
            route ===
              "/api/promo" &&
            post
          ) {
            const code = String(data.code || "").trim().toUpperCase();
            if (!user.promo_code || code !== user.promo_code) {
              fail("This promo code is not assigned to your customer ID.");
            }
            output = {
              manualRequired: true,
              message: "Promo code is valid. Contact admin to add the bonus. No automatic credit.",
            };
          } else {
            fail(
              "Not found",
              404,
            );
          }
        }
      }

      res.end(
        JSON.stringify(output),
      );
        } finally { res.end = originalEnd; }
      });
      // Responses are sent only after the PostgreSQL transaction commits.
      res.end(reply);
    } catch (error) {
      res.statusCode =
        error.status || 500;

      res.setHeader(
        "Content-Type",
        "application/json",
      );

      res.end(
        JSON.stringify({
          error: error.status
            ? error.message
            : "Server error. Please retry.",
        }),
      );

      if (!error.status) {
        console.error(
          error.message,
        );
      }
    }
  },
);

server.listen(
  Number(
    process.env.PORT || 3000,
  ),
  "0.0.0.0",
  () => {
    console.log(
      "Super Fast Aviator ready",
    );
  },
);

server.requestTimeout = 15000;
server.headersTimeout = 15000;
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(roundTimer);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
