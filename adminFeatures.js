import { randomBytes } from "node:crypto";

export function createAdminFeatures(ctx) {
  const {
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
  } = ctx;

  function column(table, name, type) {
    const exists = q(
      `PRAGMA table_info(${table})`,
    ).some((item) => item.name === name);

    if (!exists) {
      db.exec(
        `ALTER TABLE ${table}
         ADD COLUMN ${name} ${type}`,
      );
    }
  }

  column(
    "users",
    "full_name",
    "TEXT DEFAULT ''",
  );

  column(
    "users",
    "must_change",
    "INTEGER DEFAULT 0",
  );

  column(
    "rounds",
    "mode",
    "TEXT DEFAULT 'RANDOM'",
  );

  column(
    "requests",
    "details",
    "TEXT DEFAULT '{}'",
  );

  column(
    "requests",
    "proof_id",
    "TEXT DEFAULT ''",
  );

  column(
    "requests",
    "admin_note",
    "TEXT DEFAULT ''",
  );

  column(
    "requests",
    "reviewed_by",
    "INTEGER",
  );

  column(
    "requests",
    "reviewed_at",
    "TEXT",
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS media(
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      kind TEXT,
      mime TEXT,
      bytes BLOB
    );

    CREATE TABLE IF NOT EXISTS audit(
      id INTEGER PRIMARY KEY,
      admin_id INTEGER,
      action TEXT,
      target TEXT,
      note TEXT,
      created TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const savedRules = settings().rules;

  const updatedRules = savedRules
    .replace(
      /Demo coins only\./gi,
      "Simulation balance only. Amounts use the ₹ symbol for display.",
    )
    .replace(
      /Virtual demo coins only\./gi,
      "Simulation balance only.",
    );

  if (updatedRules !== savedRules) {
    run(
      "UPDATE settings SET value=? WHERE key='rules'",
      updatedRules,
    );
  }

  const previousRules = settings().rules;

  const oldRule =
    "Each round is randomly simulated on the server.";

  const newRule =
    "Random Demo uses a server-generated random outcome. " +
    "Admin-Controlled Demo uses a target fixed before betting opens. " +
    "The active mode is displayed on the game screen.";

  if (previousRules.includes(oldRule)) {
    run(
      "UPDATE settings SET value=? WHERE key='rules'",
      previousRules.replace(oldRule, newRule),
    );
  }

  const bankKeys = [
    "bankHolder",
    "bankName",
    "bankAccount",
    "bankIfsc",
    "upiId",
    "qrImageId",
    "depositInstructions",
  ];

  for (const key of bankKeys) {
    run(
      `INSERT OR IGNORE INTO settings(key,value)
       VALUES(?,?)`,
      key,
      "",
    );
  }

  function text(value, max = 120) {
    return String(value ?? "")
      .trim()
      .slice(0, max);
  }

  function audit(
    adminId,
    action,
    target,
    note = "",
  ) {
    run(
      `INSERT INTO audit(
        admin_id,action,target,note
      ) VALUES(?,?,?,?)`,
      adminId,
      action,
      String(target),
      text(note, 300),
    );
  }

  function revoke(userId) {
    for (const [token, session] of sessions) {
      if (session.id === userId) {
        sessions.delete(token);
      }
    }
  }

  function password(value, min = 8) {
    if (
      typeof value !== "string" ||
      value.length < min ||
      value.length > 128
    ) {
      fail(
        `Password must contain ${min}–128 characters.`,
      );
    }

    return value;
  }

  function imageData(value) {
    if (typeof value !== "string") {
      fail("Invalid image.");
    }

    const match =
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        value,
      );

    if (!match) {
      fail(
        "Use a PNG, JPEG or WebP image. SVG is not supported.",
      );
    }

    const bytes = Buffer.from(
      match[2],
      "base64",
    );

    if (
      bytes.length < 12 ||
      bytes.length > 1500000
    ) {
      fail("Image must be under 1.5 MB.");
    }

    let isValid = false;

    if (match[1] === "png") {
      isValid = bytes
        .subarray(0, 8)
        .equals(
          Buffer.from([
            137, 80, 78, 71,
            13, 10, 26, 10,
          ]),
        );
    } else if (match[1] === "jpeg") {
      isValid =
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255;
    } else {
      isValid =
        bytes.toString("ascii", 0, 4) ===
          "RIFF" &&
        bytes.toString("ascii", 8, 12) ===
          "WEBP";
    }

    if (!isValid) {
      fail(
        "Image content does not match its format.",
      );
    }

    return {
      bytes,
      mime: "image/" + match[1],
    };
  }

  function storeImage(data, user, kind) {
    const image = imageData(data);

    const id = randomBytes(20).toString(
      "hex",
    );

    run(
      "INSERT INTO media VALUES(?,?,?,?,?)",
      id,
      user.id,
      kind,
      image.mime,
      image.bytes,
    );

    return id;
  }

  function parseRequest(request) {
    return {
      ...request,
      details: JSON.parse(
        request.details || "{}",
      ),
    };
  }

  function summary() {
    const deposits = one(`
      SELECT COUNT(*) n
      FROM requests
      WHERE type='DEPOSIT'
      AND status='PENDING'
    `).n;

    const withdrawals = one(`
      SELECT COUNT(*) n
      FROM requests
      WHERE type='WITHDRAWAL'
      AND status='PENDING'
    `).n;

    const latestId = one(`
      SELECT COALESCE(MAX(id),0) n
      FROM requests
    `).n;

    return {
      deposits,
      withdrawals,
      total: deposits + withdrawals,
      latestId,
    };
  }

  function requestList(url) {
    const values = [];
    const where = [];

    const filters = [
      [
        "type",
        "r.type",
        ["DEPOSIT", "WITHDRAWAL"],
      ],
      [
        "status",
        "r.status",
        ["PENDING", "SUCCESS", "REJECTED"],
      ],
    ];

    for (
      const [parameter, field, allowed]
      of filters
    ) {
      const value =
        url.searchParams.get(parameter);

      if (value) {
        if (!allowed.includes(value)) {
          fail("Invalid request filter");
        }

        where.push(field + "=?");
        values.push(value);
      }
    }

    if (url.searchParams.get("before")) {
      where.push("r.id<?");

      values.push(
        Number(
          url.searchParams.get("before"),
        ) || 0,
      );
    }

    const condition = where.length
      ? "WHERE " + where.join(" AND ")
      : "";

    const rows = q(
      `
        SELECT r.*,u.username
        FROM requests r
        JOIN users u ON u.id=r.user_id
        ${condition}
        ORDER BY r.id DESC
        LIMIT 51
      `,
      ...values,
    );

    return {
      requests: rows
        .slice(0, 50)
        .map(parseRequest),

      next:
        rows.length > 50
          ? rows[49].id
          : null,
    };
  }

  function admin(
    route,
    post,
    data,
    url,
    user,
  ) {
    if (
      route === "/api/admin/game" &&
      !post
    ) {
      return {
        current: ctx.getGame(),

        configuredMode:
          settings().gameMode,

        manualMultiplier: Number(
          settings().manualMultiplier,
        ),
      };
    }

    if (
      route === "/api/admin/game" &&
      post
    ) {
      if (
        !["RANDOM", "ADMIN"].includes(
          data.mode,
        )
      ) {
        fail(
          "Choose Random or Admin Control.",
        );
      }

      const target = data.multiplier;

      if (
        !Number.isFinite(target) ||
        target < 1 ||
        target > 50 ||
        Math.abs(
          target * 100 -
            Math.round(target * 100),
        ) > 0.00001
      ) {
        fail(
          "Multiplier: 1.00–50.00, maximum two decimal places.",
        );
      }

      tx(() => {
        run(
          `UPDATE settings
           SET value=?
           WHERE key='gameMode'`,
          data.mode,
        );

        run(
          `UPDATE settings
           SET value=?
           WHERE key='manualMultiplier'`,
          target.toFixed(2),
        );

        audit(
          user.id,
          "GAME_MODE",
          data.mode,
          "Next round target: " +
            target.toFixed(2) +
            "x",
        );
      });

      return {
        appliesFromNextCountdown: true,
        current: ctx.getGame(),
      };
    }

    if (
      route === "/api/admin/summary" &&
      !post
    ) {
      return summary();
    }

    if (
      route === "/api/admin/requests" &&
      !post
    ) {
      return requestList(url);
    }

    if (
      route === "/api/admin/data" &&
      !post
    ) {
      return {
        users: q(`
          SELECT
            id,
            username,
            full_name,
            balance,
            blocked,
            must_change
          FROM users
          WHERE role='customer'
          ORDER BY id DESC
        `),

        requests: q(`
          SELECT r.*,u.username
          FROM requests r
          JOIN users u ON u.id=r.user_id
          ORDER BY r.id DESC
          LIMIT 100
        `).map(parseRequest),

        rounds: q(`
          SELECT *
          FROM rounds
          ORDER BY id DESC
          LIMIT 30
        `),

        ledger: q(`
          SELECT l.*,u.username
          FROM ledger l
          LEFT JOIN users u
            ON u.id=l.user_id
          ORDER BY l.id DESC
          LIMIT 100
        `),

        audit: q(`
          SELECT *
          FROM audit
          ORDER BY id DESC
          LIMIT 100
        `),

        settings: settings(),

        summary: summary(),

        coins: one(`
          SELECT COALESCE(SUM(amount),0) n
          FROM ledger
          WHERE note IN (
            'Admin demo credit',
            'Approved demo deposit',
            'Welcome demo bonus',
            'Promo demo bonus',
            'Losing demo bonus'
          )
        `).n,

        customerUrl: "/",
        adminUrl: "/admin",
        game: ctx.getGame(),
      };
    }

    if (
      route ===
        "/api/admin/create-customer" &&
      post
    ) {
      const fullName = text(
        data.fullName,
      );

      const username = text(
        data.username,
        30,
      ).toLowerCase();

      const temporaryPassword = password(
        data.password,
        12,
      );

      if (!fullName) {
        fail("Enter a customer name.");
      }

      if (
        !/^[a-z0-9._-]{4,30}$/.test(
          username,
        )
      ) {
        fail(
          "Login ID: 4–30 lowercase letters, numbers, dots, hyphens or underscores.",
        );
      }

      if (
        one(
          `SELECT id
           FROM users
           WHERE username=?`,
          username,
        )
      ) {
        fail("Login ID already exists.");
      }

      const id = tx(() => {
        const result = run(
          `INSERT INTO users(
            username,
            password,
            full_name,
            must_change
          ) VALUES(?,?,?,1)`,
          username,
          hash(temporaryPassword),
          fullName,
        );

        const customerId = Number(
          result.lastInsertRowid,
        );

        audit(
          user.id,
          "CREATE_CUSTOMER",
          customerId,
        );

        return customerId;
      });

      return {
        id,
        username,
        mustChangePassword: true,
      };
    }

    if (
      route === "/api/admin/customer" &&
      post
    ) {
      const customer = one(
        `SELECT *
         FROM users
         WHERE id=?
         AND role='customer'`,
        Number(data.id),
      );

      if (!customer) {
        fail("Customer not found.");
      }

      if (
        ["credit", "debit"].includes(
          data.action,
        )
      ) {
        const coins = amount(data.amount);

        const note = text(
          data.note,
          300,
        );

        if (!note) {
          fail(
            "Enter a coin adjustment note.",
          );
        }

        tx(() => {
          const balance = one(
            `SELECT balance
             FROM users
             WHERE id=?`,
            customer.id,
          ).balance;

          if (
            data.action === "debit" &&
            balance < coins
          ) {
            fail(
              "Customer has insufficient available balance.",
            );
          }

          const isCredit =
            data.action === "credit";

          credit(
            customer.id,
            isCredit ? coins : -coins,
            isCredit
              ? "Admin demo credit"
              : "Admin demo debit",
          );

          audit(
            user.id,
            isCredit
              ? "CREDIT_COINS"
              : "DEBIT_COINS",
            customer.id,
            `${coins} coins: ${note}`,
          );
        });
      } else if (
        data.action === "block"
      ) {
        run(
          `UPDATE users
           SET blocked=?
           WHERE id=?`,
          data.blocked ? 1 : 0,
          customer.id,
        );

        if (data.blocked) {
          revoke(customer.id);
        }

        audit(
          user.id,
          data.blocked
            ? "BLOCK_CUSTOMER"
            : "UNBLOCK_CUSTOMER",
          customer.id,
        );
      } else if (
        data.action === "reset-password"
      ) {
        const temporaryPassword = password(
          data.password,
          12,
        );

        run(
          `UPDATE users
           SET password=?,
               must_change=1
           WHERE id=?`,
          hash(temporaryPassword),
          customer.id,
        );

        revoke(customer.id);

        audit(
          user.id,
          "RESET_PASSWORD",
          customer.id,
        );
      } else {
        fail(
          "Unknown customer action.",
        );
      }

      return {};
    }

    if (
      route ===
        "/api/admin/payment-settings" &&
      post
    ) {
      const clean = Object.fromEntries(
        bankKeys
          .filter(
            (key) => key !== "qrImageId",
          )
          .map((key) => [
            key,
            text(
              data[key],
              key === "depositInstructions"
                ? 600
                : 120,
            ),
          ]),
      );

      clean.bankIfsc =
        clean.bankIfsc.toUpperCase();

      if (
        clean.bankAccount &&
        !/^\d{6,22}$/.test(
          clean.bankAccount,
        )
      ) {
        fail(
          "Bank account: 6–22 digits.",
        );
      }

      if (
        clean.bankIfsc &&
        !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(
          clean.bankIfsc,
        )
      ) {
        fail(
          "Enter a valid IFSC format.",
        );
      }

      if (
        clean.upiId &&
        !/^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,40}$/.test(
          clean.upiId,
        )
      ) {
        fail(
          "Enter a valid UPI ID format.",
        );
      }

      tx(() => {
        for (
          const [key, value]
          of Object.entries(clean)
        ) {
          run(
            `UPDATE settings
             SET value=?
             WHERE key=?`,
            value,
            key,
          );
        }

        const previousImage =
          settings().qrImageId;

        if (
          data.removeQr ||
          data.qrImage
        ) {
          const imageId = data.qrImage
            ? storeImage(
                data.qrImage,
                user,
                "qr",
              )
            : "";

          run(
            `UPDATE settings
             SET value=?
             WHERE key='qrImageId'`,
            imageId,
          );

          if (previousImage) {
            run(
              `DELETE FROM media
               WHERE id=?
               AND kind='qr'`,
              previousImage,
            );
          }
        }

        audit(
          user.id,
          "UPDATE_DEPOSIT_DETAILS",
          "settings",
        );
      });

      return {};
    }

    if (
      route === "/api/admin/settings" &&
      post
    ) {
      for (
        const key of [
          "welcome",
          "promo",
          "losing",
        ]
      ) {
        if (
          !Number.isInteger(data[key]) ||
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
        String(data.rules || "").length >
        4000
      ) {
        fail("Rules too long.");
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
        for (
          const key of [
            "welcome",
            "promo",
            "losing",
            "promoCode",
            "rules",
            "support",
          ]
        ) {
          run(
            `UPDATE settings
             SET value=?
             WHERE key=?`,
            String(data[key] ?? ""),
            key,
          );
        }

        audit(
          user.id,
          "UPDATE_SETTINGS",
          "settings",
        );
      });

      return {};
    }

    if (
      route === "/api/admin/request" &&
      post
    ) {
      if (
        !["SUCCESS", "REJECTED"].includes(
          data.status,
        )
      ) {
        fail("Invalid status.");
      }

      tx(() => {
        const request = one(
          `SELECT *
           FROM requests
           WHERE id=?`,
          Number(data.id),
        );

        if (
          !request ||
          request.status !== "PENDING"
        ) {
          fail(
            "Request already processed or missing.",
          );
        }

        if (
          request.type === "DEPOSIT" &&
          data.status === "SUCCESS"
        ) {
          const first = !one(
            `SELECT id
             FROM requests
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
            const bonus = Math.floor(
              (request.amount *
                Number(
                  settings().welcome,
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
          data.status === "REJECTED"
        ) {
          credit(
            request.user_id,
            request.amount,
            "Rejected withdrawal restored",
          );
        }

        run(
          `UPDATE requests
           SET status=?,
               admin_note=?,
               reviewed_by=?,
               reviewed_at=CURRENT_TIMESTAMP
           WHERE id=?`,
          data.status,
          text(data.note, 300),
          user.id,
          request.id,
        );

        audit(
          user.id,
          request.type +
            "_" +
            data.status,
          request.id,
          text(data.note, 300),
        );
      });

      return {};
    }

    fail("Not found", 404);
  }

  function customerRequest(data, user) {
    const coins = amount(
      data.amount,
      data.type === "WITHDRAWAL"
        ? 300
        : 100,
    );

    if (
      !["DEPOSIT", "WITHDRAWAL"].includes(
        data.type,
      )
    ) {
      fail("Invalid type.");
    }

    const details = {};

    const note = text(data.note, 300);

    if (data.type === "DEPOSIT") {
      details.utr = text(
        data.utr || note,
        100,
      );

      if (!details.utr) {
        fail(
          "Enter a UTR / reference.",
        );
      }
    } else {
      details.holder = text(
        data.holder,
      );

      details.bank = text(data.bank);

      details.account = text(
        data.account,
        22,
      );

      details.ifsc = text(
        data.ifsc,
        11,
      ).toUpperCase();

      if (
        !details.holder ||
        !details.bank ||
        !/^\d{6,22}$/.test(
          details.account,
        ) ||
        !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(
          details.ifsc,
        )
      ) {
        fail(
          "Complete account holder, bank, account number and valid IFSC.",
        );
      }

      if (
        data.confirmAccount !==
        details.account
      ) {
        fail(
          "Account numbers do not match.",
        );
      }
    }

    return tx(() => {
      if (
        data.type === "WITHDRAWAL"
      ) {
        const balance = one(
          `SELECT balance
           FROM users
           WHERE id=?`,
          user.id,
        ).balance;

        if (balance < coins) {
          fail(
            "Insufficient balance.",
          );
        }

        credit(
          user.id,
          -coins,
          "Demo withdrawal held",
        );
      }

      const proofId =
        data.type === "DEPOSIT" &&
        data.proof
          ? storeImage(
              data.proof,
              user,
              "proof",
            )
          : "";

      const result = run(
        `INSERT INTO requests(
          user_id,
          type,
          amount,
          note,
          details,
          proof_id
        ) VALUES(?,?,?,?,?,?)`,
        user.id,
        data.type,
        coins,
        note,
        JSON.stringify(details),
        proofId,
      );

      return {
        id: Number(
          result.lastInsertRowid,
        ),
        status: "PENDING",
      };
    });
  }

  function changePassword(data, user) {
    password(data.newPassword);

    if (
      !valid(
        String(
          data.currentPassword || "",
        ),
        user.password,
      )
    ) {
      fail(
        "Current password is incorrect.",
      );
    }

    if (
      data.newPassword ===
      data.currentPassword
    ) {
      fail(
        "Choose a different new password.",
      );
    }

    if (
      data.newPassword !==
      data.confirmPassword
    ) {
      fail(
        "New passwords do not match.",
      );
    }

    run(
      `UPDATE users
       SET password=?,
           must_change=0
       WHERE id=?`,
      hash(data.newPassword),
      user.id,
    );

    revoke(user.id);

    return {
      loginRequired: true,
    };
  }

  function media(id, user) {
    const file = one(
      `SELECT *
       FROM media
       WHERE id=?`,
      id,
    );

    if (!file) {
      fail(
        "Image not found.",
        404,
      );
    }

    const isQr =
      file.kind === "qr" &&
      settings().qrImageId === id;

    const isAdmin =
      user?.role === "admin";

    const isOwner =
      user?.role === "customer" &&
      file.user_id === user.id;

    if (
      !isQr &&
      !isAdmin &&
      !isOwner
    ) {
      fail(
        "Image access denied.",
        403,
      );
    }

    return file;
  }

  return {
    admin,
    customerRequest,
    changePassword,
    media,
  };
}
