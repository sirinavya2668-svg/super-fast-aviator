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

const dir = process.env.DATA_DIR || "./data";

fs.mkdirSync(dir, { recursive: true });

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

function tx(fn) {
  db.exec("BEGIN IMMEDIATE");

  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function hash(password) {
  const salt = randomBytes(16).toString("hex");

  const value = scryptSync(
    password,
    salt,
    64,
  ).toString("hex");

  return `${salt}:${value}`;
}

function valid(password, stored) {
  const [salt, value] = stored.split(":");

  return timingSafeEqual(
    Buffer.from(value, "hex"),
    scryptSync(password, salt, 64),
  );
}

const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword || adminPassword.length < 12) {
  throw new Error(
    "Set ADMIN_PASSWORD to a unique password of at least 12 characters.",
  );
}

const adminName =
  process.env.ADMIN_USERNAME || "admin";

const existingAdmin = one(
  "SELECT * FROM users WHERE role='admin'",
);

if (!existingAdmin) {
  run(
    `INSERT INTO users(username,password,role)
     VALUES(?,?,'admin')`,
    adminName,
    hash(adminPassword),
  );
} else {
  run(
    `UPDATE users
     SET username=?,password=?
     WHERE id=?`,
    adminName,
    hash(adminPassword),
    existingAdmin.id,
  );
}

const defaultSettings = {
  welcome: 10,
  promo: 10,
  losing: 10,
  promoCode: "SUPER10",
  rules:
    "Demo coins only. Place a bet during the countdown. " +
    "Cash out before the plane flies away. " +
    "If it flies away first, your stake is lost. " +
    "Each round is randomly simulated on the server. " +
    "Losing bonus applies to lost stakes. " +
    "Welcome bonus applies to the first approved demo deposit. " +
    "Promo code is redeemable once after an approved deposit.",
  support: "",
};

for (const [key, value] of Object.entries(defaultSettings)) {
  run(
    "INSERT OR IGNORE INTO settings VALUES(?,?)",
    key,
    String(value),
  );
}

function settings() {
  return Object.fromEntries(
    q("SELECT * FROM settings").map((item) => [
      item.key,
      item.value,
    ]),
  );
}

function credit(userId, amount, note) {
  run(
    "UPDATE users SET balance=balance+? WHERE id=?",
    amount,
    userId,
  );

  run(
    `INSERT INTO ledger(user_id,amount,note)
     VALUES(?,?,?)`,
    userId,
    amount,
    note,
  );
}

// Refund unfinished stakes after a server restart.
tx(() => {
  for (const bet of q(
    "SELECT * FROM bets WHERE status='ACTIVE'",
  )) {
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

const nextRoundId = Number(
  one(`
    SELECT MAX(
      COALESCE((SELECT MAX(id) FROM rounds),0),
      COALESCE((SELECT MAX(round_id) FROM bets),0)
    )+1 n
  `).n,
);

let round = {
  id: nextRoundId,
  phase: "WAITING",
  start: Date.now() + 7000,
  end: 0,
  crash: 1,
};

function begin() {
  round.phase = "FLYING";
  round.start = Date.now();

  const randomValue =
    randomInt(0, 1000000) / 1000000;

  round.crash = Math.min(
    50,
    Math.max(
      1,
      Math.floor(
        (0.97 / (1 - randomValue)) * 100,
      ) / 100,
    ),
  );
}

function multiplier() {
  if (round.phase !== "FLYING") {
    return 1;
  }

  const seconds =
    (Date.now() - round.start) / 1000;

  return (
    Math.floor(
      Math.exp(seconds * 0.16) * 100,
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
        "INSERT INTO rounds(id,mult) VALUES(?,?)",
        round.id,
        round.crash,
      );

      const percentage =
        Number(settings().losing);

      const activeBets = q(
        `SELECT * FROM bets
         WHERE round_id=? AND status='ACTIVE'`,
        round.id,
      );

      for (const bet of activeBets) {
        run(
          "UPDATE bets SET status='LOST' WHERE id=?",
          bet.id,
        );

        const bonus = Math.floor(
          (bet.stake * percentage) / 100,
        );

        if (bonus) {
          credit(
            bet.user_id,
            bonus,
            "Losing demo bonus",
          );
        }
      }
    });

    round.phase = "CRASHED";
    round.end = Date.now() + 3500;
  }

  if (
    round.phase === "CRASHED" &&
    Date.now() >= round.end
  ) {
    round = {
      id: round.id + 1,
      phase: "WAITING",
      start: Date.now() + 7000,
      end: 0,
      crash: 1,
    };
  }
}

const roundTimer = setInterval(advance, 80);
roundTimer.unref();

const sessions = new Map();
const limits = new Map();

setInterval(() => {
  const now = Date.now();

  for (const [key, value] of sessions) {
    if (value.exp < now) {
      sessions.delete(key);
    }
  }

  for (const [key, value] of limits) {
    if (value.exp < now) {
      limits.delete(key);
    }
  }
}, 60000).unref();

function fail(message, status = 400) {
  throw Object.assign(
    new Error(message),
    { status },
  );
}

function amount(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 100 ||
    value > 25000
  ) {
    fail(
      "Enter whole demo coins from 100 to 25,000.",
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
  };
}

async function body(req) {
  let text = "";

  for await (const chunk of req) {
    text += chunk;

    if (text.length > 16000) {
      fail("Request too large", 413);
    }
  }

  try {
    return JSON.parse(text || "{}");
  } catch {
    fail("Invalid JSON");
  }
}

function tableData() {
  return {
    users: q(`
      SELECT id,username,balance,blocked
      FROM users
      WHERE role='customer'
    `),

    requests: q(`
      SELECT r.*,u.username
      FROM requests r
      JOIN users u ON u.id=r.user_id
      ORDER BY r.id DESC
      LIMIT 200
    `),

    rounds: q(`
      SELECT *
      FROM rounds
      ORDER BY id DESC
      LIMIT 30
    `),

    settings: settings(),

    coins: one(`
      SELECT COALESCE(
        SUM(
          CASE WHEN amount>0
          THEN amount ELSE 0 END
        ),
        0
      ) n
      FROM ledger
    `).n,
  };
}

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
        "img-src 'self'; " +
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

      if (!route.startsWith("/api/")) {
        const files = {
          "/": "index.html",
          "/admin": "index.html",
          "/app.js": "app.js",
          "/style.css": "style.css",
          "/plane.svg": "plane.svg",
        };

        const file = files[route];

        if (!file) {
          fail("Not found", 404);
        }

        const contentType =
          file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : file.endsWith(".svg")
                ? "image/svg+xml"
                : "text/html";

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

      const post = req.method === "POST";

      if (
        !["GET", "POST"].includes(req.method)
      ) {
        fail("Method not allowed", 405);
      }

      if (post) {
        const origin = req.headers.origin;

        if (
          origin &&
          origin !==
            `https://${req.headers.host}` &&
          origin !==
            `http://${req.headers.host}`
        ) {
          fail("Invalid origin", 403);
        }

        if (
          !(
            req.headers["content-type"] || ""
          ).startsWith("application/json")
        ) {
          fail("JSON required", 415);
        }
      }

      const data = post
        ? await body(req)
        : {};

      let token = (
        req.headers.cookie || ""
      )
        .split(";")
        .map((value) => value.trim())
        .find((value) =>
          value.startsWith("sfa_session="),
        )
        ?.slice(12);

      const session = sessions.get(token);

      let user =
        session &&
        session.exp > Date.now()
          ? one(
              "SELECT * FROM users WHERE id=?",
              session.id,
            )
          : null;

      if (user?.blocked) {
        user = null;
      }

      let output = {};

      if (
        route === "/api/public" &&
        !post
      ) {
        output = settings();
      } else if (
        ["/api/login", "/api/signup"].includes(
          route,
        ) &&
        post
      ) {
        const key =
          req.socket.remoteAddress;

        const limit =
          limits.get(key) || {
            n: 0,
            exp: Date.now() + 900000,
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

        if (route === "/api/signup") {
          if (
            one(
              "SELECT id FROM users WHERE username=?",
              username,
            )
          ) {
            fail(
              "Username already exists.",
            );
          }

          run(
            `INSERT INTO users(username,password)
             VALUES(?,?)`,
            username,
            hash(password),
          );
        }

        const foundUser = one(
          "SELECT * FROM users WHERE username=?",
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
          data.admin &&
          foundUser.role !== "admin"
        ) {
          fail(
            "Admin account required",
            403,
          );
        }

        if (
          !data.admin &&
          foundUser.role !== "customer"
        ) {
          fail(
            "Use /admin for administrator login.",
            403,
          );
        }

        token = randomBytes(32).toString(
          "hex",
        );

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
          `sfa_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`,
        );

        output = {
          user: safeUser(foundUser),
        };
      } else if (
        route === "/api/logout" &&
        post
      ) {
        sessions.delete(token);

        res.setHeader(
          "Set-Cookie",
          "sfa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
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
          route.startsWith("/api/admin/")
        ) {
          if (
            user.role !== "admin"
          ) {
            fail(
              "Admin access required",
              403,
            );
          }

          if (
            route ===
              "/api/admin/data" &&
            !post
          ) {
            output = tableData();
          } else if (
            route ===
              "/api/admin/settings" &&
            post
          ) {
            for (const key of [
              "welcome",
              "promo",
              "losing",
            ]) {
              if (
                !Number.isInteger(
                  data[key],
                ) ||
                data[key] < 0 ||
                data[key] > 100
              ) {
                fail(
                  "Bonus percentages must be from 0 to 100.",
                );
              }
            }

            if (
              !/^[A-Z0-9_-]{3,30}$/.test(
                data.promoCode || "",
              )
            ) {
              fail(
                "Promo code: 3–30 uppercase letters/numbers.",
              );
            }

            if (
              String(
                data.rules || "",
              ).length > 4000
            ) {
              fail(
                "Rules too long.",
              );
            }

            if (
              data.support &&
              !/^https:\/\/(wa\.me|t\.me)\/[A-Za-z0-9_+/?=&%-]+$/.test(
                data.support,
              )
            ) {
              fail(
                "Enter an https://wa.me/ or https://t.me/ support link.",
              );
            }

            tx(() => {
              for (const key of [
                "welcome",
                "promo",
                "losing",
                "promoCode",
                "rules",
                "support",
              ]) {
                run(
                  "UPDATE settings SET value=? WHERE key=?",
                  String(
                    data[key] ?? "",
                  ),
                  key,
                );
              }
            });
          } else if (
            route ===
              "/api/admin/customer" &&
            post
          ) {
            const customer = one(
              `SELECT * FROM users
               WHERE id=? AND role='customer'`,
              Number(data.id),
            );

            if (!customer) {
              fail(
                "Customer not found",
              );
            }

            if (
              data.action ===
              "credit"
            ) {
              tx(() =>
                credit(
                  customer.id,
                  amount(
                    data.amount,
                  ),
                  "Admin demo credit",
                ),
              );
            } else if (
              data.action ===
              "block"
            ) {
              run(
                "UPDATE users SET blocked=? WHERE id=?",
                data.blocked
                  ? 1
                  : 0,
                customer.id,
              );
            } else {
              fail(
                "Invalid action",
              );
            }
          } else if (
            route ===
              "/api/admin/request" &&
            post
          ) {
            if (
              ![
                "SUCCESS",
                "REJECTED",
              ].includes(
                data.status,
              )
            ) {
              fail(
                "Invalid status",
              );
            }

            tx(() => {
              const request = one(
                "SELECT * FROM requests WHERE id=?",
                Number(data.id),
              );

              if (
                !request ||
                request.status !==
                  "PENDING"
              ) {
                fail(
                  "Request already processed or missing.",
                );
              }

              if (
                request.type ===
                  "DEPOSIT" &&
                data.status ===
                  "SUCCESS"
              ) {
                const first =
                  !one(
                    `SELECT id FROM requests
                     WHERE user_id=?
                     AND type='DEPOSIT'
                     AND status='SUCCESS'`,
                    request.user_id,
                  );

                credit(
                  request.user_id,
                  request.amount,
                  "Approved demo deposit",
                );

                if (first) {
                  const bonus =
                    Math.floor(
                      (request.amount *
                        Number(
                          settings()
                            .welcome,
                        )) /
                        100,
                    );

                  if (bonus) {
                    credit(
                      request.user_id,
                      bonus,
                      "Welcome demo bonus",
                    );
                  }
                }
              }

              if (
                request.type ===
                  "WITHDRAWAL" &&
                data.status ===
                  "REJECTED"
              ) {
                credit(
                  request.user_id,
                  request.amount,
                  "Rejected withdrawal restored",
                );
              }

              run(
                "UPDATE requests SET status=? WHERE id=?",
                data.status,
                request.id,
              );
            });
          } else {
            fail(
              "Not found",
              404,
            );
          }
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

          advance();

          if (
            route ===
              "/api/state" &&
            !post
          ) {
            output = {
              user: safeUser(
                one(
                  "SELECT * FROM users WHERE id=?",
                  user.id,
                ),
              ),

              round: {
                id: round.id,
                phase:
                  round.phase,
                mult:
                  round.phase ===
                  "CRASHED"
                    ? round.crash
                    : multiplier(),
                countdown:
                  Math.max(
                    0,
                    Math.ceil(
                      (round.start -
                        Date.now()) /
                        1000,
                    ),
                  ),
              },

              history: q(
                `SELECT * FROM rounds
                 ORDER BY id DESC LIMIT 12`,
              ),

              bets: q(
                `SELECT * FROM bets
                 WHERE user_id=?
                 ORDER BY id DESC LIMIT 30`,
                user.id,
              ),

              allBets: q(
                `SELECT
                   b.stake,b.status,b.mult,b.payout,
                   u.username
                 FROM bets b
                 JOIN users u ON u.id=b.user_id
                 WHERE round_id=?
                 ORDER BY b.id DESC LIMIT 50`,
                round.id,
              ),
            };
          } else if (
            route ===
              "/api/bet" &&
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

            const stake =
              amount(
                data.amount,
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
              if (
                one(
                  `SELECT id FROM bets
                   WHERE user_id=?
                   AND round_id=?
                   AND panel=?`,
                  user.id,
                  round.id,
                  data.panel,
                )
              ) {
                fail(
                  "Only one bet per panel per round.",
                );
              }

              if (
                one(
                  "SELECT balance FROM users WHERE id=?",
                  user.id,
                ).balance <
                stake
              ) {
                fail(
                  "Low demo balance.",
                );
              }

              credit(
                user.id,
                -stake,
                "Demo stake",
              );

              run(
                `INSERT INTO bets(
                  user_id,round_id,panel,stake
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
              const bet =
                one(
                  `SELECT * FROM bets
                   WHERE id=?
                   AND user_id=?
                   AND round_id=?
                   AND status='ACTIVE'`,
                  Number(
                    data.id,
                  ),
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
                 payout=?,mult=?
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
            const coins =
              amount(
                data.amount,
              );

            if (
              ![
                "DEPOSIT",
                "WITHDRAWAL",
              ].includes(
                data.type,
              )
            ) {
              fail(
                "Invalid type",
              );
            }

            const note =
              String(
                data.note ||
                  "",
              ).trim();

            if (
              !note ||
              note.length >
                300
            ) {
              fail(
                "Enter a demo reference/note, up to 300 characters.",
              );
            }

            tx(() => {
              if (
                data.type ===
                "WITHDRAWAL"
              ) {
                if (
                  one(
                    "SELECT balance FROM users WHERE id=?",
                    user.id,
                  ).balance <
                  coins
                ) {
                  fail(
                    "Low demo balance.",
                  );
                }

                credit(
                  user.id,
                  -coins,
                  "Demo withdrawal held",
                );
              }

              run(
                `INSERT INTO requests(
                  user_id,type,amount,note
                ) VALUES(?,?,?,?)`,
                user.id,
                data.type,
                coins,
                note,
              );
            });
          } else if (
            route ===
              "/api/account" &&
            !post
          ) {
            output = {
              requests: q(
                `SELECT * FROM requests
                 WHERE user_id=?
                 ORDER BY id DESC LIMIT 30`,
                user.id,
              ),
              ledger: q(
                `SELECT * FROM ledger
                 WHERE user_id=?
                 ORDER BY id DESC LIMIT 50`,
                user.id,
              ),
            };
          } else if (
            route ===
              "/api/promo" &&
            post
          ) {
            tx(() => {
              const currentSettings =
                settings();

              const code =
                String(
                  data.code ||
                    "",
                )
                  .trim()
                  .toUpperCase();

              if (
                code !==
                currentSettings.promoCode
              ) {
                fail(
                  "Invalid promo code",
                );
              }

              if (
                one(
                  `SELECT * FROM claims
                   WHERE user_id=? AND code=?`,
                  user.id,
                  code,
                )
              ) {
                fail(
                  "Code already used.",
                );
              }

              const deposit =
                one(
                  `SELECT * FROM requests
                   WHERE user_id=?
                   AND type='DEPOSIT'
                   AND status='SUCCESS'
                   ORDER BY id LIMIT 1`,
                  user.id,
                );

              if (
                !deposit
              ) {
                fail(
                  "An approved demo deposit is required first.",
                );
              }

              run(
                "INSERT INTO claims VALUES(?,?)",
                user.id,
                code,
              );

              credit(
                user.id,
                Math.floor(
                  (deposit.amount *
                    Number(
                      currentSettings.promo,
                    )) /
                    100,
                ),
                "Promo demo bonus",
              );
            });
          } else {
            fail(
              "Not found",
              404,
            );
          }
        }
      }

      res.end(
        JSON.stringify(
          output,
        ),
      );
    } catch (error) {
      res.statusCode =
        error.status ||
        500;

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

      if (
        !error.status
      ) {
        console.error(
          error.message,
        );
      }
    }
  },
);

server.listen(
  Number(
    process.env.PORT ||
      3000,
  ),
  "0.0.0.0",
  () => {
    console.log(
      "Super Fast Aviator ready",
    );
  },
);
