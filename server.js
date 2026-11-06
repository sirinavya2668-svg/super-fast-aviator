import { takeAdminTarget } from "./gamePlan.js";
import { createAdminFeatures } from "./adminFeatures.js";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir =
  process.env.DATA_DIR || "./data";

fs.mkdirSync(dir, {
  recursive: true,
});

const db = new DatabaseSync(
  path.join(dir, "aviator.sqlite"),
);

db.exec(`
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
`);

const q = (sql, ...params) =>
  db.prepare(sql).all(...params);

const one = (sql, ...params) =>
  db.prepare(sql).get(...params);

const run = (sql, ...params) =>
  db.prepare(sql).run(...params);

function tx(callback) {
  db.exec("BEGIN IMMEDIATE");

  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

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

const existingAdmin = one(
  "SELECT * FROM users WHERE role='admin'",
);

if (!existingAdmin) {
  run(
    `INSERT INTO users(
      username,
      password,
      role
    ) VALUES(?,?,'admin')`,
    adminName,
    hash(adminPassword),
  );
} else {
  run(
    `UPDATE users
     SET username=?,
         password=?
     WHERE id=?`,
    adminName,
    hash(adminPassword),
    existingAdmin.id,
  );
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
  run(
    "INSERT OR IGNORE INTO settings VALUES(?,?)",
    key,
    String(value),
  );
}

function settings() {
  return Object.fromEntries(
    q("SELECT * FROM settings").map(
      (item) => [
        item.key,
        item.value,
      ],
    ),
  );
}

function credit(userId, coins, note) {
  run(
    `UPDATE users
     SET balance=balance+?
     WHERE id=?`,
    coins,
    userId,
  );

  run(
    `INSERT INTO ledger(
      user_id,
      amount,
      note
    ) VALUES(?,?,?)`,
    userId,
    coins,
    note,
  );
}

// Refund unfinished stakes after restart.
tx(() => {
  const activeBets = q(
    "SELECT * FROM bets WHERE status='ACTIVE'",
  );

  for (const bet of activeBets) {
    credit(
      bet.user_id,
      bet.stake,
      "Interrupted round refund",
    );

    run(
      "UPDATE bets SET status='VOID' WHERE id=?",
      bet.id,
    );
  }
});

function buildRound(id) {
  const currentSettings = settings();

  const mode =
    currentSettings.gameMode === "ADMIN"
      ? "ADMIN"
      : "RANDOM";

  // One plan entry per new countdown.
  // Current waiting/flying rounds stay locked.
  const target =
    mode === "ADMIN"
      ? takeAdminTarget({
          settings,
          run,
          tx,
        })
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

const nextRoundId = Number(
  one(`
    SELECT MAX(
      COALESCE(
        (SELECT MAX(id) FROM rounds),
        0
      ),
      COALESCE(
        (SELECT MAX(round_id) FROM bets),
        0
      )
    )+1 n
  `).n,
);

let round = buildRound(nextRoundId);

function begin() {
  round.phase = "FLYING";
  round.start = Date.now();

  if (round.mode === "ADMIN") {
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

function advance() {
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
    tx(() => {
      run(
        `INSERT INTO rounds(
          id,
          mult,
          mode
        ) VALUES(?,?,?)`,
        round.id,
        round.crash,
        round.mode,
      );

      const activeBets = q(
        `SELECT *
         FROM bets
         WHERE round_id=?
         AND status='ACTIVE'`,
        round.id,
      );

      for (const bet of activeBets) {
        run(
          "UPDATE bets SET status='LOST' WHERE id=?",
          bet.id,
        );


      }
    });

    round.phase = "CRASHED";
    round.end = Date.now() + 3500;
  }

  if (
    round.phase === "CRASHED" &&
    Date.now() >= round.end
  ) {
    round = buildRound(
      round.id + 1,
    );
  }
}

const roundTimer = setInterval(
  advance,
  80,
);

roundTimer.unref();

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
  createAdminFeatures({
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
  });

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
          ? one(
              `SELECT *
               FROM users
               WHERE id=?`,
              session.id,
            )
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
            ? one(
                `SELECT *
                 FROM users
                 WHERE id=?
                 AND role='admin'
                 AND blocked=0`,
                adminSession.id,
              )
            : null;

        const file =
          features.media(
            route.slice(
              "/api/media/".length,
            ),
            adminUser || user,
          );

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
          promoCode: legacyPromoCode,
          ...publicSettings
        } = settings();

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
          const exists = one(
            `SELECT id
             FROM users
             WHERE username=?`,
            username,
          );

          if (exists) {
            fail(
              "Username already exists.",
            );
          }

          run(
            `INSERT INTO users(
              username,
              password
            ) VALUES(?,?)`,
            username,
            hash(password),
          );
        }

        const foundUser = one(
          `SELECT *
           FROM users
           WHERE username=?`,
          username,
        );

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
            features.admin(
              route,
              post,
              data,
              url,
              user,
            );
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

          advance();

          if (
            route ===
              "/api/state" &&
            !post
          ) {
            output = {
              user: safeUser(
                one(
                  `SELECT *
                   FROM users
                   WHERE id=?`,
                  user.id,
                ),
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

              history: q(`
                SELECT *
                FROM rounds
                ORDER BY id DESC
                LIMIT 12
              `),

              bets: q(
                `SELECT *
                 FROM bets
                 WHERE user_id=?
                 ORDER BY id DESC
                 LIMIT 30`,
                user.id,
              ),

              allBets: q(
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
              ),
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

            tx(() => {
              const duplicate =
                one(
                  `SELECT id
                   FROM bets
                   WHERE user_id=?
                   AND round_id=?
                   AND panel=?`,
                  user.id,
                  round.id,
                  data.panel,
                );

              if (duplicate) {
                fail(
                  "Only one bet per panel per round.",
                );
              }

              const balance =
                one(
                  `SELECT balance
                   FROM users
                   WHERE id=?`,
                  user.id,
                ).balance;

              if (
                balance < stake
              ) {
                fail(
                  "Insufficient balance.",
                );
              }

              credit(
                user.id,
                -stake,
                "Demo stake",
              );

              run(
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
              );
            });
          } else if (
            route ===
              "/api/cashout" &&
            post
          ) {
            advance();

            if (
              round.phase !==
              "FLYING"
            ) {
              fail(
                "Cash out unavailable.",
              );
            }

            tx(() => {
              const bet = one(
                `SELECT *
                 FROM bets
                 WHERE id=?
                 AND user_id=?
                 AND round_id=?
                 AND status='ACTIVE'`,
                Number(data.id),
                user.id,
                round.id,
              );

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

              run(
                `UPDATE bets
                 SET status='WON',
                     payout=?,
                     mult=?
                 WHERE id=?`,
                payout,
                current,
                bet.id,
              );

              credit(
                user.id,
                payout,
                "Demo cash out",
              );
            });
          } else if (
            route ===
              "/api/request" &&
            post
          ) {
            output =
              features.customerRequest(
                data,
                user,
              );
          } else if (
            route ===
              "/api/password" &&
            post
          ) {
            output =
              features.changePassword(
                data,
                user,
              );
          } else if (
            route ===
              "/api/account" &&
            !post
          ) {
            output = {
              requests: q(
                `SELECT *
                 FROM requests
                 WHERE user_id=?
                 ORDER BY id DESC
                 LIMIT 30`,
                user.id,
              ),

              ledger: q(
                `SELECT *
                 FROM ledger
                 WHERE user_id=?
                 ORDER BY id DESC
                 LIMIT 50`,
                user.id,
              ),
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
