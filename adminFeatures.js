import { createManualBonuses } from "./manualBonus.js";
import { normalizePlan, savedPlan } from "./gamePlan.js";
import { randomBytes } from "node:crypto";

export async function createAdminFeatures(ctx) {
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

  async function column(table, name, type) {
    return await db.exec(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${type}`
    );
  }

  await column("users", "full_name", "TEXT DEFAULT ''");
  await column("users", "promo_code", "TEXT DEFAULT ''");

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_customer_promo_unique
    ON users(promo_code) WHERE promo_code <> ''
  `);

  async function customerPromo(value, exceptId = 0) {
    if (value === undefined || value === null || value === "") {
      return "";
    }

    if (typeof value !== "string") {
      fail("Enter a valid promo code.");
    }

    const code = value.trim().toUpperCase();

    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) {
      fail(
        "Promo code: 3–30 letters, numbers, hyphens or underscores."
      );
    }

    if (
      await one(
        "SELECT id FROM users WHERE promo_code=? AND id<>?",
        code,
        exceptId
      )
    ) {
      fail(
        "This promo code is already assigned to another customer.",
        409
      );
    }

    return code;
  }

  await column("users", "must_change", "INTEGER DEFAULT 0");
  await column("rounds", "mode", "TEXT DEFAULT 'RANDOM'");
  await column("requests", "details", "TEXT DEFAULT '{}'");
  await column("requests", "proof_id", "TEXT DEFAULT ''");
  await column("requests", "admin_note", "TEXT DEFAULT ''");
  await column("requests", "reviewed_by", "INTEGER");
  await column("requests", "reviewed_at", "TEXT");

  await db.exec(`
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

  const addManualBonus = await createManualBonuses({
    ...ctx,
    audit,
  });

  const ruleReplacements = [
    [
      "Losing bonus applies to lost stakes.",
      "Losing bonus is added only by admin after review of losses of ₹10,000 or more.",
    ],
    [
      "Welcome bonus applies to the first approved demo deposit.",
      "Welcome bonus is added only by admin; deposit approval does not add a bonus automatically.",
    ],
    [
      "Promo code is redeemable once after an approved deposit.",
      "Promo codes are checked for validity; only admin can add the promo bonus.",
    ],
  ];

  let manualRules = (await settings()).rules;

  for (const [before, after] of ruleReplacements) {
    manualRules = manualRules.replace(before, after);
  }

  if (!manualRules.includes("No bonus is credited automatically.")) {
    manualRules += " No bonus is credited automatically.";
  }

  await run(
    "UPDATE settings SET value=? WHERE key='rules'",
    manualRules
  );

  const savedRules = (await settings()).rules;

  const updatedRules = savedRules
    .replace(
      /Demo coins only\./gi,
      "Simulation balance only. Amounts use the ₹ symbol for display."
    )
    .replace(
      /Virtual demo coins only\./gi,
      "Simulation balance only."
    );

  if (updatedRules !== savedRules) {
    await run(
      "UPDATE settings SET value=? WHERE key='rules'",
      updatedRules
    );
  }

  const previousRules = (await settings()).rules;
  const oldRule = "Each round is randomly simulated on the server.";

  const newRule =
    "Random Demo uses a server-generated random outcome. " +
    "Admin-Controlled Demo uses a target fixed before betting opens. " +
    "The active mode is displayed on the game screen.";

  if (previousRules.includes(oldRule)) {
    await run(
      "UPDATE settings SET value=? WHERE key='rules'",
      previousRules.replace(oldRule, newRule)
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
    await run(
      "INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)",
      key,
      ""
    );
  }

  function text(value, max = 120) {
    return String(value ?? "").trim().slice(0, max);
  }

  async function audit(adminId, action, target, note = "") {
    await run(
      `INSERT INTO audit(
        admin_id,action,target,note
      ) VALUES(?,?,?,?)`,
      adminId,
      action,
      String(target),
      text(note, 300)
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
      fail(`Password must contain ${min}–128 characters.`);
    }

    return value;
  }

  function imageData(value) {
    if (typeof value !== "string") {
      fail("Invalid image.");
    }

    const match =
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        value
      );

    if (!match) {
      fail("Use a PNG, JPEG or WebP image. SVG is not supported.");
    }

    const bytes = Buffer.from(match[2], "base64");

    if (bytes.length < 12 || bytes.length > 1500000) {
      fail("Image must be under 1.5 MB.");
    }

    let isValid = false;

    if (match[1] === "png") {
      isValid = bytes.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      );
    } else if (match[1] === "jpeg") {
      isValid =
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255;
    } else {
      isValid =
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP";
    }

    if (!isValid) {
      fail("Image content does not match its format.");
    }

    return {
      bytes,
      mime: "image/" + match[1],
    };
  }

  async function storeImage(data, user, kind) {
    const image = imageData(data);
    const id = randomBytes(20).toString("hex");

    await run(
      "INSERT INTO media VALUES(?,?,?,?,?)",
      id,
      user.id,
      kind,
      image.mime,
      image.bytes
    );

    return id;
  }

  function parseRequest(request) {
    return {
      ...request,
      details: JSON.parse(request.details || "{}"),
    };
  }

  async function summary() {
    const deposits = (
      await one(`
        SELECT COUNT(*) n
        FROM requests
        WHERE type='DEPOSIT'
        AND status='PENDING'
      `)
    ).n;

    const withdrawals = (
      await one(`
        SELECT COUNT(*) n
        FROM requests
        WHERE type='WITHDRAWAL'
        AND status='PENDING'
      `)
    ).n;

    const latestId = (
      await one(`
        SELECT COALESCE(MAX(id),0) n
        FROM requests
      `)
    ).n;

    return {
      deposits,
      withdrawals,
      total: deposits + withdrawals,
      latestId,
    };
  }

  async function requestList(url) {
    const values = [];
    const where = [];
    const customerFilter = url.searchParams.get("userId");

    if (customerFilter) {
      const customerId = Number(customerFilter);

      if (!Number.isSafeInteger(customerId) || customerId < 1) {
        fail("Invalid customer filter.");
      }

      where.push("r.user_id=?");
      values.push(customerId);
    }

    const filters = [
      ["type", "r.type", ["DEPOSIT", "WITHDRAWAL"]],
      ["status", "r.status", ["PENDING", "SUCCESS", "REJECTED"]],
    ];

    for (const [parameter, field, allowed] of filters) {
      const value = url.searchParams.get(parameter);

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
      values.push(Number(url.searchParams.get("before")) || 0);
    }

    const condition = where.length
      ? "WHERE " + where.join(" AND ")
      : "";

    const rows = await q(
      `SELECT r.*,u.username
       FROM requests r
       JOIN users u ON u.id=r.user_id
       ${condition}
       ORDER BY r.id DESC
       LIMIT 51`,
      ...values
    );

    return {
      requests: rows.slice(0, 50).map(parseRequest),
      next: rows.length > 50 ? rows[49].id : null,
    };
  }

  async function admin(route, post, data, url, user) {
    if (route === "/api/admin/bonus" && post) {
      return addManualBonus(data, user);
    }

    if (route === "/api/admin/game" && !post) {
      return {
        current: ctx.getGame(),
        targets: savedPlan(await settings()),
        nextIndex: Number((await settings()).adminPlanCursor || 0),
        configuredMode: (await settings()).gameMode,
        manualMultiplier: Number(
          (await settings()).manualMultiplier
        ),
      };
    }

    if (route === "/api/admin/game" && post) {
      if (!["RANDOM", "ADMIN"].includes(data.mode)) {
        fail("Choose Random or Admin Control.");
      }

      let targets;

      try {
        targets = normalizePlan(
          data.targets === undefined
            ? [data.multiplier]
            : data.targets,
          data.mode === "RANDOM"
        );
      } catch (error) {
        fail(error.message);
      }

      const first = targets.find(value => value !== null) ?? 2;

      await tx(async () => {
        await run(
          "UPDATE settings SET value=? WHERE key='gameMode'",
          data.mode
        );

        await run(
          "UPDATE settings SET value=? WHERE key='manualMultiplier'",
          first.toFixed(2)
        );

        await run(
          `INSERT INTO settings(key,value)
           VALUES('adminPlan',?)
           ON CONFLICT(key)
           DO UPDATE SET value=excluded.value`,
          JSON.stringify(targets)
        );

        await run(
          `INSERT INTO settings(key,value)
           VALUES('adminPlanCursor','0')
           ON CONFLICT(key)
           DO UPDATE SET value='0'`
        );

        const planDescription = targets
          .map((value, index) =>
            value === null
              ? null
              : `${index + 1}:${value.toFixed(2)}x`
          )
          .filter(Boolean)
          .join(", ");

        await audit(
          user.id,
          "GAME_MODE",
          data.mode,
          "Repeating plan: " + planDescription
        );
      });

      return {
        appliesFromNextCountdown: true,
        current: ctx.getGame(),
      };
    }

    if (route === "/api/admin/summary" && !post) {
      return await summary();
    }

    if (route === "/api/admin/requests" && !post) {
      return await requestList(url);
    }

    if (route === "/api/admin/data" && !post) {
      return {
        users: await q(`
          SELECT
            id,username,full_name,balance,
            blocked,must_change,promo_code
          FROM users
          WHERE role='customer'
          ORDER BY id DESC
        `),

        requests: (
          await q(`
            SELECT r.*,u.username
            FROM requests r
            JOIN users u ON u.id=r.user_id
            ORDER BY r.id DESC
            LIMIT 100
          `)
        ).map(parseRequest),

        rounds: await q(`
          SELECT *
          FROM rounds
          ORDER BY id DESC
          LIMIT 30
        `),

        ledger: await q(`
          SELECT l.*,u.username
          FROM ledger l
          LEFT JOIN users u ON u.id=l.user_id
          ORDER BY l.id DESC
          LIMIT 100
        `),

        audit: await q(`
          SELECT *
          FROM audit
          ORDER BY id DESC
          LIMIT 100
        `),

        settings: await settings(),
        summary: await summary(),

        coins: (
          await one(`
            SELECT COALESCE(SUM(amount),0) n
            FROM ledger
            WHERE note IN (
              'Admin demo credit',
              'Approved demo deposit',
              'Welcome demo bonus',
              'Promo demo bonus',
              'Losing demo bonus',
              'Manual welcome bonus',
              'Manual promo bonus',
              'Manual losing bonus'
            )
          `)
        ).n,

        customerUrl: "/",
        adminUrl: "/admin",
        game: ctx.getGame(),
      };
    }

    if (route === "/api/admin/create-customer" && post) {
      const fullName = text(data.fullName);
      const username = text(data.username, 30).toLowerCase();
      const temporaryPassword = password(data.password, 12);

      if (!fullName) {
        fail("Enter a customer name.");
      }

      if (!/^[a-z0-9._-]{4,30}$/.test(username)) {
        fail(
          "Login ID: 4–30 lowercase letters, numbers, dots, hyphens or underscores."
        );
      }

      if (
        await one(
          "SELECT id FROM users WHERE username=?",
          username
        )
      ) {
        fail("Login ID already exists.");
      }

      const id = await tx(async () => {
        const promoCode = await customerPromo(data.promoCode);

        const result = await run(
          `INSERT INTO users(
            username,password,full_name,must_change,promo_code
          ) VALUES(?,?,?,1,?)`,
          username,
          hash(temporaryPassword),
          fullName,
          promoCode
        );

        const customerId = Number(result.lastInsertRowid);

        await audit(
          user.id,
          "CREATE_CUSTOMER",
          customerId,
          "Promo code: " + (promoCode || "Not assigned")
        );

        return customerId;
      });

      return {
        id,
        username,
        promoCode: (
          await one(
            "SELECT promo_code FROM users WHERE id=?",
            id
          )
        ).promo_code,
        mustChangePassword: true,
      };
    }

    if (route === "/api/admin/customer" && post) {
      const customer = await one(
        `SELECT *
         FROM users
         WHERE id=? AND role='customer'`,
        Number(data.id)
      );

      if (!customer) {
        fail("Customer not found.");
      }

      if (["credit", "debit"].includes(data.action)) {
        const coins = amount(data.amount);
        const note = text(data.note, 300);

        if (!note) {
          fail("Enter a coin adjustment note.");
        }

        await tx(async () => {
          const balance = (
            await one(
              "SELECT balance FROM users WHERE id=?",
              customer.id
            )
          ).balance;

          if (data.action === "debit" && balance < coins) {
            fail("Customer has insufficient available balance.");
          }

          const isCredit = data.action === "credit";

          await credit(
            customer.id,
            isCredit ? coins : -coins,
            isCredit ? "Admin demo credit" : "Admin demo debit"
          );

          await audit(
            user.id,
            isCredit ? "CREDIT_COINS" : "DEBIT_COINS",
            customer.id,
            `${coins} coins: ${note}`
          );
        });
      } else if (data.action === "set-promo") {
        await tx(async () => {
          const promoCode = await customerPromo(
            data.promoCode,
            customer.id
          );

          await run(
            "UPDATE users SET promo_code=? WHERE id=?",
            promoCode,
            customer.id
          );

          await audit(
            user.id,
            "SET_CUSTOMER_PROMO",
            customer.id,
            "Promo code: " + (promoCode || "Removed")
          );
        });
      } else if (data.action === "block") {
        await run(
          "UPDATE users SET blocked=? WHERE id=?",
          data.blocked ? 1 : 0,
          customer.id
        );

        if (data.blocked) {
          revoke(customer.id);
        }

        await audit(
          user.id,
          data.blocked ? "BLOCK_CUSTOMER" : "UNBLOCK_CUSTOMER",
          customer.id
        );
      } else if (data.action === "reset-password") {
        const temporaryPassword = password(data.password, 12);

        await run(
          `UPDATE users
           SET password=?,must_change=1
           WHERE id=?`,
          hash(temporaryPassword),
          customer.id
        );

        revoke(customer.id);

        await audit(
          user.id,
          "RESET_PASSWORD",
          customer.id
        );
      } else {
        fail("Unknown customer action.");
      }

      return {};
    }

    if (route === "/api/admin/payment-settings" && post) {
      const clean = Object.fromEntries(
        bankKeys
          .filter(key => key !== "qrImageId")
          .map(key => [
            key,
            text(
              data[key],
              key === "depositInstructions" ? 600 : 120
            ),
          ])
      );

      clean.bankIfsc = clean.bankIfsc.toUpperCase();

      if (
        clean.bankAccount &&
        !/^\d{6,22}$/.test(clean.bankAccount)
      ) {
        fail("Bank account: 6–22 digits.");
      }

      if (
        clean.bankIfsc &&
        !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(clean.bankIfsc)
      ) {
        fail("Enter a valid IFSC format.");
      }

      if (
        clean.upiId &&
        !/^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,40}$/.test(
          clean.upiId
        )
      ) {
        fail("Enter a valid UPI ID format.");
      }

      await tx(async () => {
        for (const [key, value] of Object.entries(clean)) {
          await run(
            "UPDATE settings SET value=? WHERE key=?",
            value,
            key
          );
        }

        const previousImage = (await settings()).qrImageId;

        if (data.removeQr || data.qrImage) {
          const imageId = data.qrImage
            ? await storeImage(data.qrImage, user, "qr")
            : "";

          await run(
            "UPDATE settings SET value=? WHERE key='qrImageId'",
            imageId
          );

          if (previousImage) {
            await run(
              "DELETE FROM media WHERE id=? AND kind='qr'",
              previousImage
            );
          }
        }

        await audit(
          user.id,
          "UPDATE_DEPOSIT_DETAILS",
          "settings"
        );
      });

      return {};
    }

    if (route === "/api/admin/settings" && post) {
      for (const key of ["welcome", "promo", "losing"]) {
        if (
          !Number.isInteger(data[key]) ||
          data[key] < 0 ||
          data[key] > 100
        ) {
          fail("Bonus percentages must be from 0 to 100.");
        }
      }

      if (!/^[A-Z0-9_-]{3,30}$/.test(data.promoCode || "")) {
        fail("Promo code: 3–30 uppercase letters/numbers.");
      }

      if (String(data.rules || "").length > 4000) {
        fail("Rules too long.");
      }

      if (
        data.support &&
        !/^https:\/\/(wa\.me|t\.me)\/[A-Za-z0-9_+/?=&%-]+$/.test(
          data.support
        )
      ) {
        fail(
          "Enter an https://wa.me/ or https://t.me/ support link."
        );
      }

      await tx(async () => {
        for (const key of [
          "welcome",
          "promo",
          "losing",
          "promoCode",
          "rules",
          "support",
        ]) {
          await run(
            "UPDATE settings SET value=? WHERE key=?",
            String(data[key] ?? ""),
            key
          );
        }

        await audit(
          user.id,
          "UPDATE_SETTINGS",
          "settings"
        );
      });

      return {};
    }

    if (route === "/api/admin/request" && post) {
      if (!["SUCCESS", "REJECTED"].includes(data.status)) {
        fail("Invalid status.");
      }

      await tx(async () => {
        const request = await one(
          "SELECT * FROM requests WHERE id=?",
          Number(data.id)
        );

        if (!request || request.status !== "PENDING") {
          fail("Request already processed or missing.");
        }

        if (
          request.type === "DEPOSIT" &&
          data.status === "SUCCESS"
        ) {
          await credit(
            request.user_id,
            request.amount,
            "Approved demo deposit"
          );
        }

        if (
          request.type === "WITHDRAWAL" &&
          data.status === "REJECTED"
        ) {
          await credit(
            request.user_id,
            request.amount,
            "Rejected withdrawal restored"
          );
        }

        await run(
          `UPDATE requests
           SET status=?,
               admin_note=?,
               reviewed_by=?,
               reviewed_at=CURRENT_TIMESTAMP
           WHERE id=?`,
          data.status,
          text(data.note, 300),
          user.id,
          request.id
        );

        await audit(
          user.id,
          request.type + "_" + data.status,
          request.id,
          text(data.note, 300)
        );
      });

      return {};
    }

    fail("Not found", 404);
  }

  async function customerRequest(data, user) {
    const coins = amount(
      data.amount,
      data.type === "WITHDRAWAL" ? 300 : 100
    );

    if (!["DEPOSIT", "WITHDRAWAL"].includes(data.type)) {
      fail("Invalid type.");
    }

    const details = {};
    const note = text(data.note, 300);

    if (data.type === "DEPOSIT") {
      details.utr = text(data.utr || note, 100);

      if (!details.utr) {
        fail("Enter a UTR / reference.");
      }
    } else {
      details.holder = text(data.holder);
      details.bank = text(data.bank);
      details.account = text(data.account, 22);
      details.ifsc = text(data.ifsc, 11).toUpperCase();

      if (
        !details.holder ||
        !details.bank ||
        !/^\d{6,22}$/.test(details.account) ||
        !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(details.ifsc)
      ) {
        fail(
          "Complete account holder, bank, account number and valid IFSC."
        );
      }

      if (data.confirmAccount !== details.account) {
        fail("Account numbers do not match.");
      }
    }

    return await tx(async () => {
      if (data.type === "WITHDRAWAL") {
        const balance = (
          await one(
            "SELECT balance FROM users WHERE id=?",
            user.id
          )
        ).balance;

        if (balance < coins) {
          fail("Insufficient balance.");
        }

        await credit(
          user.id,
          -coins,
          "Demo withdrawal held"
        );
      }

      const proofId =
        data.type === "DEPOSIT" && data.proof
          ? await storeImage(data.proof, user, "proof")
          : "";

      const result = await run(
        `INSERT INTO requests(
          user_id,type,amount,note,details,proof_id
        ) VALUES(?,?,?,?,?,?)`,
        user.id,
        data.type,
        coins,
        note,
        JSON.stringify(details),
        proofId
      );

      return {
        id: Number(result.lastInsertRowid),
        status: "PENDING",
      };
    });
  }

  async function changePassword(data, user) {
    password(data.newPassword);

    if (
      !valid(
        String(data.currentPassword || ""),
        user.password
      )
    ) {
      fail("Current password is incorrect.");
    }

    if (data.newPassword === data.currentPassword) {
      fail("Choose a different new password.");
    }

    if (data.newPassword !== data.confirmPassword) {
      fail("New passwords do not match.");
    }

    await run(
      `UPDATE users
       SET password=?,must_change=0
       WHERE id=?`,
      hash(data.newPassword),
      user.id
    );

    revoke(user.id);

    return {
      loginRequired: true,
    };
  }

  async function media(id, user) {
    const file = await one(
      "SELECT * FROM media WHERE id=?",
      id
    );

    if (!file) {
      fail("Image not found.", 404);
    }

    const isQr =
      file.kind === "qr" &&
      (await settings()).qrImageId === id;

    const isAdmin = user?.role === "admin";

    const isOwner =
      user?.role === "customer" &&
      file.user_id === user.id;

    if (!isQr && !isAdmin && !isOwner) {
      fail("Image access denied.", 403);
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
