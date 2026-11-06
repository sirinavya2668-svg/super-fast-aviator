const $ = (selector) =>
  document.querySelector(selector);

const app = $("#app");
const modal = $("#modal");

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

const num = (value) =>
  Number(value || 0).toLocaleString("en-IN");

const money = (value) =>
  "₹" + num(value);

const ledgerLabel = (value) =>
  String(value || "").replace(
    /demo\s+/gi,
    "",
  );

const when = (value) =>
  value
    ? new Date(
        value.replace(" ", "T") + "Z",
      ).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
      }) + " IST"
    : "";

let me = null;
let data = null;
let page = "Dashboard";
let requestRows = [];
let next = null;
let lastSeen = 0;
let polling = false;

const pages = [
  "Dashboard",
  "Customer IDs",
  "Wallet Management",
  "Deposit Requests",
  "Withdrawal Requests",
  "Deposit Details / QR",
  "Game Control",
  "Bonus Settings",
  "Promo Codes",
  "Rules",
  "Support Settings",
  "Audit Log",
];

function brand() {
  return `
    <div class="brand">
      <img src="/plane.svg" alt="">
      <div>
        <small>SUPER FAST</small>
        <strong>AVIATOR</strong>
      </div>
    </div>
  `;
}

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");

  setTimeout(() => {
    $("#toast").classList.remove("visible");
  }, 4500);
}

async function api(route, body) {
  const response = await fetch(
    "/api/" + route,
    {
      method: body ? "POST" : "GET",

      headers: body
        ? {
            "Content-Type": "application/json",
          }
        : {},

      body: body
        ? JSON.stringify(body)
        : undefined,
    },
  );

  const result = await response.json();

  if (!response.ok) {
    if (
      response.status === 401 &&
      route !== "admin/login"
    ) {
      me = null;
      loginScreen();
    }

    throw new Error(
      result.error || "Request failed",
    );
  }

  return result;
}

function show(title, html) {
  modal.innerHTML = `
    <div class="dialoghead">
      <h2>${esc(title)}</h2>

      <button
        data-close
        aria-label="Close"
      >×</button>
    </div>

    ${html}
  `;

  if (!modal.open) {
    modal.showModal();
  }
}

modal.addEventListener(
  "click",
  (event) => {
    if (
      event.target.closest("[data-close]")
    ) {
      modal.close();
    }
  },
);

function field(
  label,
  name,
  value = "",
  type = "text",
  extra = "",
) {
  return `
    <label>
      ${label}

      <input
        name="${name}"
        type="${type}"
        value="${esc(value)}"
        ${extra}
      >
    </label>
  `;
}

async function readImage(file) {
  if (!file?.size) {
    return null;
  }

  if (file.size > 1500000) {
    throw new Error(
      "Image must be under 1.5 MB.",
    );
  }

  return new Promise(
    (resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () =>
        resolve(reader.result);

      reader.onerror = () =>
        reject(
          new Error("Could not read image"),
        );

      reader.readAsDataURL(file);
    },
  );
}

function formHandler(selector, handler) {
  const form = $(selector);

  if (!form) {
    return;
  }

  form.onsubmit = async (event) => {
    event.preventDefault();

    const button = form.querySelector(
      "[type=submit]",
    );

    if (button.disabled) {
      return;
    }

    button.disabled = true;

    form.querySelector(
      ".error",
    ).textContent = "";

    try {
      await handler(
        Object.fromEntries(
          new FormData(form),
        ),
        form,
      );
    } catch (error) {
      form.querySelector(
        ".error",
      ).textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}

function loginScreen() {
  app.innerHTML = `
    <main class="adminlogin">
      ${brand()}

      <h1>ADMIN PANEL</h1>
      <p>Separate administrator login</p>

      <form id="adminlogin">
        ${field(
          "Admin ID",
          "username",
          "",
          "text",
          'required autocomplete="username"',
        )}

        ${field(
          "Password",
          "password",
          "",
          "password",
          'required autocomplete="current-password"',
        )}

        <button
          type="submit"
          class="green full"
        >ADMIN LOGIN</button>

        <p class="error"></p>
      </form>

      <p class="muted">
        Customer accounts use the customer link.
      </p>

      <a href="/">Open Customer Site</a>
    </main>
  `;

  formHandler(
    "#adminlogin",
    async (body) => {
      me = (
        await api("admin/login", body)
      ).user;

      await load();
    },
  );
}

function reqTable(rows) {
  return `
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Ref / Customer</th>
            <th>Amount</th>
            <th>Type</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          ${
            rows.map(
              (request) => `
                <tr>
                  <td>
                    #${request.id} ·
                    ${esc(request.username)}

                    <small>
                      ${esc(
                        when(request.created),
                      )}
                    </small>
                  </td>

                  <td>
                    ${money(request.amount)}
                  </td>

                  <td>
                    ${esc(request.type)}
                  </td>

                  <td>
                    <span class="pill">
                      ${esc(request.status)}
                    </span>
                  </td>

                  <td>
                    <button
                      class="green mini"
                      data-review="${request.id}"
                    >
                      ${
                        request.status === "PENDING"
                          ? "Review"
                          : "Details"
                      }
                    </button>
                  </td>
                </tr>
              `,
            ).join("") ||
            `
              <tr>
                <td colspan="5">
                  No requests yet
                </td>
              </tr>
            `
          }
        </tbody>
      </table>
    </div>
  `;
}

function roundTable() {
  return `
    <div class="tablewrap">
      <table>
        <tr>
          <th>Round</th>
          <th>Multiplier</th>
          <th>Mode</th>
        </tr>

        ${
          data.rounds.map(
            (round) => `
              <tr>
                <td>#${round.id}</td>

                <td>
                  ${round.mult.toFixed(2)}x
                </td>

                <td>
                  ${
                    round.mode === "ADMIN"
                      ? "Admin-Controlled Demo"
                      : "Random Demo"
                  }
                </td>
              </tr>
            `,
          ).join("") ||
          `
            <tr>
              <td>No completed rounds</td>
            </tr>
          `
        }
      </table>
    </div>
  `;
}

function settingsForm() {
  const titles = {
    welcome: "Welcome Bonus",
    promo: "Promo Code Bonus",
    losing: "Losing Bonus",
  };

  return `
    <form id="settings">
      ${[
        "welcome",
        "promo",
        "losing",
      ].map(
        (key) => field(
          titles[key] + " %",
          key,
          data.settings[key],
          "number",
          'min="0" max="100" step="1" required',
        ),
      ).join("")}

      ${field(
        "Promo Code",
        "promoCode",
        data.settings.promoCode,
        "text",
        'pattern="[A-Z0-9_-]{3,30}" required',
      )}

      <label>
        Rules

        <textarea
          name="rules"
          rows="6"
          maxlength="4000"
        >${esc(
          data.settings.rules,
        )}</textarea>
      </label>

      ${field(
        "24/7 Support Link (WhatsApp / Telegram)",
        "support",
        data.settings.support,
        "url",
      )}

      <button
        type="submit"
        class="wine"
      >SAVE SETTINGS</button>

      <p class="error"></p>
    </form>
  `;
}

function paymentsForm() {
  const settings = data.settings;

  return `
    <p>
      These details appear on the customer
      deposit screen. No payment is
      sent or verified by this application.
    </p>

    <form id="payments">
      <div class="formgrid">
        ${field(
          "Account Holder",
          "bankHolder",
          settings.bankHolder,
        )}

        ${field(
          "Bank Name",
          "bankName",
          settings.bankName,
        )}

        ${field(
          "Account Number",
          "bankAccount",
          settings.bankAccount,
          "text",
          'inputmode="numeric" pattern="[0-9]{6,22}"',
        )}

        ${field(
          "IFSC",
          "bankIfsc",
          settings.bankIfsc,
          "text",
          'maxlength="11"',
        )}

        ${field(
          "UPI ID",
          "upiId",
          settings.upiId,
        )}
      </div>

      <label>
        Customer instructions

        <textarea
          name="depositInstructions"
          maxlength="600"
          rows="3"
        >${esc(
          settings.depositInstructions,
        )}</textarea>
      </label>

      ${
        settings.qrImageId
          ? `
            <img
              class="qrpreview"
              alt="Current deposit QR"
              src="/api/media/${esc(
                settings.qrImageId,
              )}"
            >

            <label class="checkrow">
              <input
                name="removeQr"
                type="checkbox"
              >
              Remove current QR
            </label>
          `
          : ""
      }

      <label>
        Upload QR image
        (PNG / JPEG / WebP, max 1.5 MB)

        <input
          name="qr"
          type="file"
          accept="image/png,image/jpeg,image/webp"
        >
      </label>

      <button
        type="submit"
        class="green"
      >SAVE DEPOSIT DETAILS</button>

      <p class="error"></p>
    </form>
  `;
}

function gameForm() {
  const game = data.game;
  const settings = data.settings;

  let plan;

  try {
    plan = JSON.parse(
      settings.adminPlan || "null",
    );
  } catch {
    plan = null;
  }

  if (!Array.isArray(plan)) {
    plan = [
      Number(settings.manualMultiplier) || 2,
    ];
  }

  const filled = plan
    .map((value, index) => ({
      value,
      slot: index + 1,
    }))
    .filter(
      (entry) => entry.value !== null,
    );

  const nextEntry = filled[
    Number(
      settings.adminPlanCursor || 0,
    ) % (filled.length || 1)
  ];

  return `
    <p class="modebanner">
      Current round #${game.id}:

      <strong>
        ${
          game.mode === "ADMIN"
            ? "ADMIN-CONTROLLED DEMO"
            : "RANDOM DEMO"
        }
      </strong>

      · ${esc(game.phase)}
    </p>

    <p>
      Changes apply when the next betting
      countdown starts. The current round
      is locked. Every customer sees the
      active demo mode.
    </p>

    <form id="gamecontrol">
      <label>
        Next Round Mode

        <select name="mode">
          <option
            value="RANDOM"
            ${
              settings.gameMode === "RANDOM"
                ? "selected"
                : ""
            }
          >
            Random — automatic server outcome
          </option>

          <option
            value="ADMIN"
            ${
              settings.gameMode === "ADMIN"
                ? "selected"
                : ""
            }
          >
            Admin Control — fixed demo multiplier
          </option>
        </select>
      </label>

      <fieldset class="planfieldset">
        <legend>
          Admin target multipliers (1.00–50.00x)
        </legend>

        <p class="muted">
          Fill any of the 50 boxes.
          Empty boxes are skipped.
        </p>

        <div class="multipliergrid">
          ${Array.from(
            { length: 50 },
            (_, index) => `
              <label>
                <span>#${index + 1}</span>

                <input
                  name="target${index}"
                  type="number"
                  min="1"
                  max="50"
                  step="0.01"
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="—"
                  aria-label="Multiplier box ${index + 1}"
                  value="${
                    plan[index] == null
                      ? ""
                      : esc(
                          Number(
                            plan[index],
                          ).toFixed(2),
                        )
                  }"
                >
              </label>
            `,
          ).join("")}
        </div>
      </fieldset>

      <p class="muted">
        Current round box:
        ${
          game.mode === "ADMIN" &&
          game.planSlot
            ? "#" + game.planSlot
            : "—"
        }.

        Next saved box:
        ${
          nextEntry
            ? "#" + nextEntry.slot
            : "—"
        }.

        Save starts the updated plan from
        its first filled box at the next countdown.
      </p>

      <p class="muted">
        Admin Control uses the filled boxes
        in numbered order, one per round.
        After the last filled box, it repeats
        from the first filled box.
        The plan continues until you save
        a new plan or select Random.
        Targets are fixed before betting starts.
        Simulation balance only.
      </p>

      <button
        type="submit"
        class="wine"
      >SAVE NEXT ROUND MODE</button>

      <p class="error"></p>
    </form>

    <h3 class="spaced">
      Recent Completed Rounds
    </h3>

    ${roundTable()}
  `;
}

async function load() {
  data = await api("admin/data");

  lastSeen = Math.max(
    lastSeen,
    data.summary.latestId,
  );

  render();

  if (page === "Wallet Management") {
    await loadRequests();
  }
}

function render() {
  app.innerHTML = `
    <div class="adminshell">
      <aside>
        ${brand()}

        <h4>ADMIN PANEL</h4>

        <nav>
          ${pages.map(
            (title, index) => `
              <button
                data-page="${index}"
                class="${
                  page === title
                    ? "green"
                    : ""
                }"
              >
                ${esc(title)}

                ${
                  title === "Deposit Requests"
                    ? `
                      <span
                        class="navcount"
                        id="depositCount"
                      >
                        ${data.summary.deposits}
                      </span>
                    `
                    : title === "Withdrawal Requests"
                      ? `
                        <span
                          class="navcount"
                          id="withdrawalCount"
                        >
                          ${data.summary.withdrawals}
                        </span>
                      `
                      : ""
                }
              </button>
            `,
          ).join("")}
        </nav>

        <button
          class="outline full"
          data-logout
        >ADMIN LOGOUT</button>
      </aside>

      <main class="adminmain">
        <header>
          <h1>${esc(page)}</h1>

          <span class="pill">
            DEMO MODE
          </span>

          <button
            class="green mini"
            data-refresh
          >Refresh</button>
        </header>

        <button
          id="newrequest"
          class="wine full"
          hidden
        ></button>

        <div id="admincontent"></div>

        <footer>
          Simulation account administration ·
          Requests refresh every 10 seconds
        </footer>
      </main>
    </div>
  `;

  let html = "";

  if (page === "Dashboard") {
    const stats = [
      ["Customers", data.users.length],
      ["Total Amount Credited", data.coins],
      [
        "Pending Deposits",
        data.summary.deposits,
      ],
      [
        "Pending Withdrawals",
        data.summary.withdrawals,
      ],
    ];

    html = `
      <div class="portalLinks card">
        <h2>Separate Portal Links</h2>

        <p>
          Customer:
          <a
            href="/"
            target="_blank"
            rel="noopener"
          >${esc(location.origin)}/</a>
        </p>

        <p>
          Admin:
          <a href="/admin">
            ${esc(location.origin)}/admin
          </a>
        </p>
      </div>

      <div class="stats">
        ${stats.map(
          ([title, value]) => `
            <div class="card">
              <span>${title}</span>

              <b>
                ${
                  title === "Total Amount Credited"
                    ? money(value)
                    : num(value)
                }
              </b>
            </div>
          `,
        ).join("")}
      </div>

      <div class="admingrid">
        <section class="card">
          <h2>Latest Customer Requests</h2>

          ${reqTable(
            data.requests.slice(0, 6),
          )}
        </section>

        <section class="card">
          <h2>Game Mode</h2>

          <p>
            ${
              data.game.mode === "ADMIN"
                ? "Admin-Controlled Demo"
                : "Random Demo"
            }
          </p>

          <button
            class="wine"
            data-page="6"
          >GAME CONTROL</button>

          <h3 class="spaced">
            Deposit Information
          </h3>

          <p>Bank details, UPI and QR image</p>

          <button
            class="green"
            data-page="5"
          >MANAGE BANK / QR</button>
        </section>
      </div>
    `;
  } else if (page === "Customer IDs") {
    html = `
      <section class="card">
        <h2>Create Customer ID</h2>

        <form id="createcustomer">
          <div class="formgrid">
            ${field(
              "Customer Name",
              "fullName",
              "",
              "text",
              'required maxlength="120"',
            )}

            ${field(
              "Login ID",
              "username",
              "",
              "text",
              'pattern="[a-z0-9._\\-]{4,30}" required',
            )}

            ${field(
              "Temporary Password (12–128 characters)",
              "password",
              "",
              "password",
              'minlength="12" maxlength="128" required autocomplete="new-password"',
            )}
          </div>

          <p class="muted">
            New account starts with ₹0 balance.
            Customer must change the temporary
            password on first login.
          </p>

          <button
            type="submit"
            class="green"
          >CREATE ID</button>

          <p class="error"></p>
        </form>
      </section>

      <section class="card spaced">
        <h2>Customer Accounts</h2>
        ${usersTable()}
      </section>
    `;
  } else if (page === "Wallet Management") {
    html = `
      <section class="card">
        <h2>Add / Deduct Balance</h2>
        ${usersTable()}
      </section>

      <section class="card spaced">
        <h2>
          Customer Deposit / Withdrawal History
        </h2>

        <div class="requestfilters">
          <label>
            Customer

            <select id="walletcustomer">
              <option value="">All Customers</option>

              ${data.users.map(
                (user) => `
                  <option value="${user.id}">
                    ${esc(user.username)}${
                      user.full_name
                        ? " · " + esc(user.full_name)
                        : ""
                    }
                  </option>
                `,
              ).join("")}
            </select>
          </label>

          <label>
            Request Type

            <select id="wallettype">
              <option value="">
                Deposit + Withdrawal
              </option>
              <option value="DEPOSIT">
                Deposit
              </option>
              <option value="WITHDRAWAL">
                Withdrawal
              </option>
            </select>
          </label>

          <label>
            Status

            <select id="requeststatus">
              <option value="">All</option>
              <option value="PENDING">
                Pending
              </option>
              <option value="SUCCESS">
                Approved / Success
              </option>
              <option value="REJECTED">
                Rejected
              </option>
            </select>
          </label>

          <button
            class="green mini"
            data-filter
          >SHOW HISTORY</button>
        </div>

        <div id="requesttable">
          ${reqTable(requestRows)}
        </div>

        <button
          data-more
          class="outline"
          ${next ? "" : "hidden"}
        >Load Older Requests</button>
      </section>

      <section class="card spaced">
        <h2>Wallet Transaction Log</h2>

        <div class="tablewrap">
          <table>
            <tr>
              <th>Customer</th>
              <th>Amount</th>
              <th>Reason</th>
              <th>Time</th>
            </tr>

            ${data.ledger.map(
              (entry) => `
                <tr>
                  <td>
                    ${esc(entry.username)}
                  </td>

                  <td>
                    ${money(entry.amount)}
                  </td>

                  <td>
                    ${esc(
                      ledgerLabel(entry.note),
                    )}
                  </td>

                  <td>
                    ${esc(
                      when(entry.created),
                    )}
                  </td>
                </tr>
              `,
            ).join("")}
          </table>
        </div>
      </section>
    `;
  } else if (page.includes(" Requests")) {
    html = `
      <section class="card">
        <div class="requestfilters">
          <h2>${esc(page)}</h2>

          <label>
            Status

            <select id="requeststatus">
              <option value="">All</option>
              <option>PENDING</option>
              <option>SUCCESS</option>
              <option>REJECTED</option>
            </select>
          </label>

          <button
            class="green mini"
            data-filter
          >Apply</button>
        </div>

        <div id="requesttable">
          ${reqTable(requestRows)}
        </div>

        <button
          data-more
          class="outline"
          ${next ? "" : "hidden"}
        >Load Older Requests</button>
      </section>
    `;
  } else if (page === "Deposit Details / QR") {
    html = `
      <section class="card">
        <h2>Customer Deposit Details</h2>
        ${paymentsForm()}
      </section>
    `;
  } else if (page === "Game Control") {
    html = `
      <section class="card">
        <h2>Random / Admin Control</h2>
        ${gameForm()}
      </section>
    `;
  } else if (page === "Audit Log") {
    html = `
      <section class="card">
        <h2>Admin Actions</h2>

        <div class="tablewrap">
          <table>
            <tr>
              <th>Action</th>
              <th>Target</th>
              <th>Note</th>
              <th>Time</th>
            </tr>

            ${data.audit.map(
              (entry) => `
                <tr>
                  <td>
                    ${esc(entry.action)}
                  </td>

                  <td>
                    ${esc(entry.target)}
                  </td>

                  <td>
                    ${esc(
                      ledgerLabel(entry.note),
                    )}
                  </td>

                  <td>
                    ${esc(
                      when(entry.created),
                    )}
                  </td>
                </tr>
              `,
            ).join("")}
          </table>
        </div>
      </section>
    `;
  } else {
    html = `
      <section class="card">
        <h2>${esc(page)}</h2>
        ${settingsForm()}
      </section>
    `;
  }

  $("#admincontent").innerHTML = html;

  formHandler(
    "#createcustomer",
    async (body) => {
      const result = await api(
        "admin/create-customer",
        body,
      );

      await load();

      show(
        "Customer ID Created",
        `
          <p>
            Customer link:
            <strong>
              ${esc(location.origin)}/
            </strong>
          </p>

          <p>
            Login ID:
            <strong>
              ${esc(result.username)}
            </strong>
          </p>

          <p>
            Give the temporary password you
            entered directly to the customer.
            It must be changed on first login.
          </p>
        `,
      );
    },
  );

  formHandler(
    "#payments",
    async (body, form) => {
      const qr = await readImage(
        form.querySelector(
          "[name=qr]",
        ).files[0],
      );

      await api(
        "admin/payment-settings",
        {
          ...body,
          qrImage: qr,
          removeQr: !!body.removeQr,
        },
      );

      await load();
      toast("Bank / QR details saved");
    },
  );

  formHandler(
    "#settings",
    async (body) => {
      for (const key of [
        "welcome",
        "promo",
        "losing",
      ]) {
        body[key] = Number(body[key]);
      }

      await api("admin/settings", body);

      await load();
      toast("Settings saved");
    },
  );

  formHandler(
    "#gamecontrol",
    async (body) => {
      const targets = Array.from(
        { length: 50 },
        (_, index) => {
          const value = String(
            body["target" + index] || "",
          ).trim();

          return value === ""
            ? null
            : Number(value);
        },
      );

      await api(
        "admin/game",
        {
          mode: body.mode,
          targets,
        },
      );

      await load();

      toast(
        "Plan saved. Starts at the first filled box from the next countdown.",
      );
    },
  );
}

function usersTable() {
  return `
    <div class="tablewrap">
      <table>
        <tr>
          <th>Customer / Login ID</th>
          <th>Amount</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>

        ${
          data.users.map(
            (user) => `
              <tr>
                <td>
                  ${esc(user.full_name)}

                  <small>
                    ID:
                    ${esc(user.username)}
                  </small>
                </td>

                <td>
                  ${money(user.balance)}
                </td>

                <td>
                  ${
                    user.blocked
                      ? "BLOCKED"
                      : "ACTIVE"
                  }

                  ${
                    user.must_change
                      ? `
                        <small>
                          Password change required
                        </small>
                      `
                      : ""
                  }
                </td>

                <td class="actionbuttons">
                  <button
                    class="green mini"
                    data-coins="${user.id}"
                  >Manage Balance</button>

                  <button
                    class="wine mini"
                    data-block="${user.id},${
                      user.blocked ? 0 : 1
                    }"
                  >
                    ${
                      user.blocked
                        ? "Unblock"
                        : "Block"
                    }
                  </button>

                  <button
                    class="mini"
                    data-reset="${user.id}"
                  >Reset Password</button>
                </td>
              </tr>
            `,
          ).join("") ||
          `
            <tr>
              <td colspan="4">
                No customers yet
              </td>
            </tr>
          `
        }
      </table>
    </div>
  `;
}

async function loadRequests(
  older = false,
) {
  const type =
    page === "Wallet Management"
      ? $("#wallettype")?.value || ""
      : page.startsWith("Deposit")
        ? "DEPOSIT"
        : "WITHDRAWAL";

  const customer =
    page === "Wallet Management"
      ? $("#walletcustomer")?.value || ""
      : "";

  const status =
    $("#requeststatus")?.value || "";

  const before =
    older && next
      ? "&before=" + next
      : "";

  const result = await api(
    `admin/requests?type=${type}&status=${status}&userId=${encodeURIComponent(customer)}${before}`,
  );

  requestRows = older
    ? [
        ...requestRows,
        ...result.requests,
      ]
    : result.requests;

  next = result.next;

  if ($("#requesttable")) {
    $("#requesttable").innerHTML =
      reqTable(requestRows);

    $("[data-more]").hidden = !next;
  }
}

function review(id) {
  const request = [
    ...requestRows,
    ...data.requests,
  ].find(
    (item) => item.id === id,
  );

  if (!request) {
    return;
  }

  const details =
    request.details || {};

  show(
    "Request #" + request.id,
    `
      <p>
        <strong>
          ${esc(request.username)}
        </strong>

        · ${esc(request.type)}
        · ${money(request.amount)}
        AMOUNT
      </p>

      <p>
        Status:
        <strong>
          ${esc(request.status)}
        </strong>
      </p>

      <p>
        ${esc(when(request.created))}
      </p>

      <div class="bankdetails">
        ${Object.entries(details).map(
          ([key, value]) => `
            <p>
              <b>${esc(key)}:</b>
              ${esc(value)}
            </p>
          `,
        ).join("")}

        <p>
          <b>Note:</b>
          ${esc(request.note)}
        </p>
      </div>

      ${
        request.proof_id
          ? `
            <a
              href="/api/media/${esc(
                request.proof_id,
              )}"
              target="_blank"
              rel="noopener"
            >
              <img
                class="proofpreview"
                alt="Customer uploaded demo proof"
                src="/api/media/${esc(
                  request.proof_id,
                )}"
              >
            </a>
          `
          : ""
      }

      <p>
        ${
          request.type === "WITHDRAWAL"
            ? "The withdrawal amount was held when this request was submitted. Rejection restores them; approval marks the request complete. No bank transfer is performed."
            : "Approval credits the balance. This app does not verify a real payment."
        }
      </p>

      ${
        request.status === "PENDING"
          ? `
            <form id="reviewform">
              ${field(
                "Admin note (optional)",
                "note",
                "",
                "text",
                'maxlength="300"',
              )}

              <label>
                Decision

                <select name="status">
                  <option value="SUCCESS">
                    Approve
                  </option>

                  <option value="REJECTED">
                    Reject
                  </option>
                </select>
              </label>

              <button
                type="submit"
                class="green full"
              >SAVE DECISION</button>

              <p class="error"></p>
            </form>
          `
          : `
            <p>
              Admin note:
              ${esc(request.admin_note)}
            </p>

            <p>
              Reviewed:
              ${esc(
                when(request.reviewed_at),
              )}
            </p>
          `
      }
    `,
  );

  formHandler(
    "#reviewform",
    async (body) => {
      await api(
        "admin/request",
        {
          id,
          ...body,
        },
      );

      modal.close();
      await load();

      if (page.includes(" Requests")) {
        await loadRequests();
      }

      toast("Request updated");
    },
  );
}

app.addEventListener(
  "click",
  async (event) => {
    const button =
      event.target.closest("button");

    if (
      !button ||
      button.disabled
    ) {
      return;
    }

    try {
      if (
        button.hasAttribute(
          "data-logout",
        )
      ) {
        await api("admin/logout", {});

        me = null;
        loginScreen();
      } else if (
        button.hasAttribute(
          "data-refresh",
        ) ||
        button.id === "newrequest"
      ) {
        await load();

        if (page.includes(" Requests")) {
          await loadRequests();
        }
      } else if (
        button.dataset.page !== undefined
      ) {
        page = pages[
          Number(button.dataset.page)
        ];

        requestRows = [];
        next = null;

        await load();

        if (page.includes(" Requests")) {
          await loadRequests();
        }
      } else if (
        button.dataset.review
      ) {
        review(
          Number(
            button.dataset.review,
          ),
        );
      } else if (
        button.hasAttribute(
          "data-filter",
        )
      ) {
        await loadRequests();
      } else if (
        button.hasAttribute(
          "data-more",
        )
      ) {
        await loadRequests(true);
      } else if (
        button.dataset.block
      ) {
        const [id, blocked] =
          button.dataset.block.split(",");

        await api(
          "admin/customer",
          {
            id: Number(id),
            action: "block",
            blocked: Number(blocked),
          },
        );

        await load();
      } else if (
        button.dataset.reset
      ) {
        const id = Number(
          button.dataset.reset,
        );

        show(
          "Reset Customer Password",
          `
            <form id="resetform">
              ${field(
                "New temporary password",
                "password",
                "",
                "password",
                'required minlength="12" maxlength="128" autocomplete="new-password"',
              )}

              <button
                type="submit"
                class="wine full"
              >RESET PASSWORD</button>

              <p class="error"></p>
            </form>
          `,
        );

        formHandler(
          "#resetform",
          async (body) => {
            await api(
              "admin/customer",
              {
                id,
                action: "reset-password",
                password: body.password,
              },
            );

            modal.close();
            await load();

            toast(
              "Temporary password reset. Existing customer sessions ended.",
            );
          },
        );
      } else if (
        button.dataset.coins
      ) {
        const id = Number(
          button.dataset.coins,
        );

        const bonusRequestKey =
          crypto.randomUUID();

        const user = data.users.find(
          (item) => item.id === id,
        );

        show(
          "Wallet · " + user.username,
          `
            <p>
              Available:
              ${money(user.balance)}
            </p>

            <form id="coinsform">
              <label>
                Action

                <select name="action">
                  <option value="credit">
                    Add Balance
                  </option>

                  <option value="debit">
                    Deduct Balance
                  </option>

                  <option value="bonus-WELCOME">
                    Add Welcome Bonus
                  </option>

                  <option value="bonus-PROMO">
                    Add Promo Code Bonus
                  </option>

                  <option value="bonus-LOSING">
                    Add Losing Bonus
                  </option>
                </select>
              </label>

              ${field(
                "Amount (₹1–₹25,000)",
                "amount",
                1000,
                "number",
                'required min="1" max="25000" step="1"',
              )}

              ${field(
                "Reviewed loss amount (Losing Bonus only)",
                "lossAmount",
                10000,
                "number",
                'min="10000" max="1000000000" step="1"',
              )}

              <p class="muted">
                Balance adjustments start at ₹100;
                bonus credits start at ₹1.
                All bonuses are manual.
                For Losing Bonus, record the reviewed
                loss of ₹10,000 or more.
                Enter the bonus amount separately above.
              </p>

              ${field(
                "Reason / Note",
                "note",
                "",
                "text",
                'required maxlength="300"',
              )}

              <button
                type="submit"
                class="green full"
              >SAVE ADJUSTMENT</button>

              <p class="error"></p>
            </form>
          `,
        );

        formHandler(
          "#coinsform",
          async (body) => {
            if (
              body.action.startsWith(
                "bonus-",
              )
            ) {
              await api(
                "admin/bonus",
                {
                  id,
                  kind:
                    body.action.slice(6),
                  amount:
                    Number(body.amount),
                  lossAmount:
                    Number(body.lossAmount),
                  note: body.note,
                  requestKey:
                    bonusRequestKey,
                },
              );
            } else {
              await api(
                "admin/customer",
                {
                  id,
                  ...body,
                  amount:
                    Number(body.amount),
                },
              );
            }

            modal.close();
            await load();

            toast("Balance updated");
          },
        );
      }
    } catch (error) {
      toast(error.message);
    }
  },
);

async function poll() {
  if (
    !me ||
    polling ||
    document.hidden
  ) {
    return;
  }

  polling = true;

  try {
    const result = await api(
      "admin/summary",
    );

    if ($("#depositCount")) {
      $("#depositCount").textContent =
        result.deposits;
    }

    if ($("#withdrawalCount")) {
      $("#withdrawalCount").textContent =
        result.withdrawals;
    }

    if (
      result.latestId > lastSeen
    ) {
      const button =
        $("#newrequest");

      if (button) {
        button.hidden = false;

        button.textContent =
          "New customer request received — Refresh to view";
      }
    }
  } catch {
    // Retry during the next polling interval.
  } finally {
    polling = false;
  }
}

try {
  me = (
    await api("me?portal=admin")
  ).user;

  if (me?.role === "admin") {
    await load();
  } else {
    loginScreen();
  }
} catch (error) {
  loginScreen();
  toast(error.message);
}

setInterval(
  poll,
  10000,
);
