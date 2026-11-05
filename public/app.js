const $ = (selector) =>
  document.querySelector(selector);

const app = $("#app");
const modal = $("#modal");

let me = null;
let config = {};
let state = null;
let busy = false;
let tab = "ALL";
let page = "Dashboard";
let adminData = null;

const adminRoute =
  location.pathname === "/admin";

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
  Number(value || 0).toLocaleString(
    "en-IN",
  );

const pct = (key) =>
  esc(config[key] ?? 10);

function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add(
    "visible",
  );

  setTimeout(() => {
    $("#toast").classList.remove(
      "visible",
    );
  }, 4000);
}

async function api(route, data) {
  const response = await fetch(
    "/api/" + route,
    {
      method: data
        ? "POST"
        : "GET",

      headers: data
        ? {
            "Content-Type":
              "application/json",
          }
        : {},

      body: data
        ? JSON.stringify(data)
        : undefined,
    },
  );

  const result =
    await response.json();

  if (!response.ok) {
    throw new Error(
      result.error,
    );
  }

  return result;
}

const logo = () => `
  <div class="brand">
    <img src="/plane.svg" alt="">
    <div>
      <small>SUPER FAST</small>
      <strong>AVIATOR</strong>
    </div>
  </div>
`;

const bonuses = () => `
  <div class="bonusrow">
    ${[
      [
        "welcome",
        "WELCOME<br>BONUS",
      ],
      [
        "promo",
        "PROMO CODE<br>BONUS",
      ],
      [
        "losing",
        "LOSING<br>BONUS",
      ],
    ]
      .map(
        ([key, title]) => `
          <div class="bonus">
            <b>${pct(key)}%</b>
            <span>${title}</span>
          </div>
        `,
      )
      .join("")}
  </div>
`;

function show(title, html) {
  modal.innerHTML = `
    <div class="dialoghead">
      <h2>${esc(title)}</h2>
      <button
        data-close
        aria-label="Close dialog"
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
      event.target.closest(
        "[data-close]",
      )
    ) {
      modal.close();
    }
  },
);

function support() {
  if (config.support) {
    window.open(
      config.support,
      "_blank",
      "noopener,noreferrer",
    );
  } else {
    show(
      "24/7 Customer Support",
      `<p>
        The administrator has not
        configured a support link yet.
      </p>`,
    );
  }
}

function welcome() {
  app.innerHTML = `
    <main class="welcome">
      <header>
        <button
          data-auth="login"
          class="outline"
        >LOGIN</button>

        <button
          data-auth="signup"
          class="wine"
        >SIGN UP</button>
      </header>

      <div class="welcomecontent">
        <div class="herologo">
          <img
            src="/plane.svg"
            alt="Airplane"
          >
          <small>SUPER FAST</small>
          <h1>AVIATOR</h1>
          <i></i>
        </div>

        ${bonuses()}

        <button
          class="support wine"
          data-support
        >
          24/7 CUSTOMER SUPPORT
        </button>

        <p class="muted demofoot">
          Virtual demo coins only
        </p>
      </div>
    </main>
  `;
}

function adminLoginScreen() {
  app.innerHTML = `
    <div class="adminlogin">
      ${logo()}
      <h1>ADMIN PANEL</h1>
      <button
        class="green"
        data-auth="login"
      >ADMIN LOGIN</button>
      <p>Virtual demo management</p>
    </div>
  `;
}

function auth(mode = "login") {
  const title = adminRoute
    ? "Admin Login"
    : mode === "signup"
      ? "Create Account"
      : "Login";

  show(
    title,
    `
      <form id="authform">
        <label>
          Username
          <input
            name="username"
            autocomplete="username"
            required
            pattern="[a-zA-Z0-9._-]{4,30}"
            minlength="4"
            maxlength="30"
          >
        </label>

        <label>
          Password
          <input
            name="password"
            type="password"
            autocomplete="${
              mode === "signup"
                ? "new-password"
                : "current-password"
            }"
            minlength="${
              adminRoute
                ? 12
                : 8
            }"
            maxlength="128"
            required
          >
        </label>

        <p class="muted">
          ${
            adminRoute
              ? "Use the admin credentials configured on your server."
              : "Username: 4–30 letters/numbers. Password: at least 8 characters."
          }
        </p>

        <button
          class="green full"
          type="submit"
        >
          ${
            mode === "signup"
              ? "SIGN UP"
              : "LOGIN"
          }
        </button>

        <p
          class="error"
          id="formerror"
        ></p>
      </form>
    `,
  );

  $("#authform").onsubmit =
    async (event) => {
      event.preventDefault();

      const button =
        event.target.querySelector(
          "button",
        );

      button.disabled = true;

      try {
        const data =
          Object.fromEntries(
            new FormData(
              event.target,
            ),
          );

        const result =
          await api(
            mode === "signup"
              ? "signup"
              : "login",
            {
              ...data,
              admin: adminRoute,
            },
          );

        me = result.user;

        modal.close();

        if (adminRoute) {
          await renderAdmin();
        } else {
          renderGame();
          await refresh();
        }
      } catch (error) {
        const errorElement =
          $("#formerror");

        if (errorElement) {
          errorElement.textContent =
            error.message;
        }
      } finally {
        button.disabled = false;
      }
    };
}

function panel(number) {
  return `
    <section
      class="betpanel"
      id="panel${number}"
    >
      <div>
        <div class="paneltitle">
          BET ${number}
          <span>DEMO COINS</span>
        </div>

        <div class="stake">
          <button
            data-step="-${number}"
            aria-label="Decrease bet ${number}"
          >−</button>

          <input
            id="stake${number}"
            type="number"
            min="100"
            max="25000"
            step="100"
            value="100"
            aria-label="Bet ${number} stake"
          >

          <button
            data-step="${number}"
            aria-label="Increase bet ${number}"
          >+</button>
        </div>

        <div class="quick">
          ${[
            100,
            200,
            500,
            1000,
          ]
            .map(
              (coins) => `
                <button
                  data-quick="${number},${coins}"
                >${coins}</button>
              `,
            )
            .join("")}
        </div>
      </div>

      <button
        class="betaction green"
        data-bet="${number}"
      >WAIT…</button>
    </section>
  `;
}

function renderGame() {
  app.innerHTML = `
    <main class="game">
      <nav class="gamenav">
        <button
          class="green"
          data-request="DEPOSIT"
        >DEPOSIT</button>

        <button
          class="wine"
          data-request="WITHDRAWAL"
        >WITHDRAWAL</button>

        <button
          id="menutoggle"
          aria-label="Open menu"
          aria-expanded="false"
        >☰</button>

        <div id="gamemenu" hidden>
          <button
            data-info="rules"
          >Rules</button>

          <button
            data-info="bonus"
          >Bonus Information</button>

          <button
            data-info="promo"
          >Promo Code</button>
        </div>
      </nav>

      <header class="gamehead">
        ${logo()}

        <div class="balance">
          <b id="balance">
            ${num(me.balance)}
          </b>

          <small>
            DEMO COINS ·
            ${esc(me.username)}
          </small>
        </div>
      </header>

      <div
        id="history"
        class="history"
      ></div>

      <section class="chart">
        <div class="chartgrid"></div>

        <svg
          viewBox="0 0 600 250"
          preserveAspectRatio="none"
          class="trail"
        >
          <path
            d="M5 240 Q360 245 560 45"
          />
        </svg>

        <img
          id="flyingplane"
          src="/plane.svg"
          alt="Flying airplane"
        >

        <div class="roundstatus">
          <span id="phase">
            CONNECTING
          </span>

          <b id="mult">1.00x</b>

          <small id="roundid"></small>
        </div>
      </section>

      ${panel(1)}
      ${panel(2)}

      <div class="betstabs">
        <button
          class="green"
          data-tab="ALL"
        >ALL BETS</button>

        <button
          data-tab="MY"
        >MY BETS</button>
      </div>

      <div class="tablewrap">
        <table>
          <thead id="bethead"></thead>
          <tbody id="betrows"></tbody>
        </table>
      </div>

      <footer>
        <span>
          Virtual demo coins only
        </span>

        <button
          data-account
        >History</button>

        <button
          data-logout
        >Logout</button>

        <button
          data-support
          aria-label="Customer support"
        >24/7 Support</button>
      </footer>
    </main>
  `;

  $("#menutoggle").onclick = () => {
    const menu =
      $("#gamemenu");

    menu.hidden =
      !menu.hidden;

    $("#menutoggle").setAttribute(
      "aria-expanded",
      String(!menu.hidden),
    );
  };
}

async function refresh() {
  if (
    !me ||
    adminRoute ||
    busy
  ) {
    return;
  }

  try {
    state = await api(
      "state",
    );

    me = state.user;

    $("#balance").textContent =
      num(me.balance);

    $("#history").innerHTML =
      state.history
        .map(
          (item, index) => `
            <span
              class="${
                index % 2
                  ? "wine"
                  : "green"
              }"
            >
              ${item.mult.toFixed(2)}x
            </span>
          `,
        )
        .join("") ||
      "<span>First demo round</span>";

    const current =
      state.round;

    $("#phase").textContent =
      current.phase ===
      "WAITING"
        ? `NEXT ROUND IN ${current.countdown}s`
        : current.phase ===
            "FLYING"
          ? "FLYING"
          : "FLEW AWAY";

    $("#mult").textContent =
      current.phase ===
      "WAITING"
        ? "GET READY"
        : current.mult.toFixed(
            2,
          ) + "x";

    $("#mult").classList.toggle(
      "crashed",
      current.phase ===
        "CRASHED",
    );

    $("#roundid").textContent =
      "ROUND #" +
      current.id;

    $("#flyingplane").className =
      current.phase ===
      "FLYING"
        ? "flying"
        : current.phase ===
            "CRASHED"
          ? "gone"
          : "";

    for (const number of [
      1,
      2,
    ]) {
      const bet =
        state.bets.find(
          (item) =>
            item.round_id ===
              current.id &&
            item.panel ===
              number,
        );

      const button = $(
        `[data-bet="${number}"]`,
      );

      button.classList.toggle(
        "wine",
        !!bet &&
          current.phase ===
            "FLYING",
      );

      button.disabled =
        (
          !!bet &&
          (
            bet.status !==
              "ACTIVE" ||
            current.phase !==
              "FLYING"
          )
        ) ||
        (
          !bet &&
          current.phase !==
            "WAITING"
        );

      if (
        bet &&
        bet.status ===
          "ACTIVE" &&
        current.phase ===
          "FLYING"
      ) {
        button.innerHTML = `
          CASH OUT
          <small>
            ${num(
              Math.floor(
                bet.stake *
                  current.mult,
              ),
            )}
            DEMO COINS
          </small>
        `;
      } else if (bet) {
        button.innerHTML = `
          ${
            bet.status ===
            "ACTIVE"
              ? "BET PLACED"
              : esc(
                  bet.status,
                )
          }
          <small>
            ${num(
              bet.stake,
            )}
            DEMO COINS
          </small>
        `;
      } else {
        button.innerHTML =
          current.phase ===
          "WAITING"
            ? "BET<small>DEMO COINS</small>"
            : "NEXT ROUND";
      }
    }

    renderBets();
  } catch {
    if ($("#phase")) {
      $("#phase").textContent =
        "CONNECTION LOST · RETRYING";
    }

    for (
      const button of
      document.querySelectorAll(
        "[data-bet]",
      )
    ) {
      button.disabled = true;
    }
  }
}

function renderBets() {
  if (!state) {
    return;
  }

  $("#bethead").innerHTML =
    tab === "ALL"
      ? `
        <tr>
          <th>PLAYER</th>
          <th>BET</th>
          <th>STATUS</th>
        </tr>
      `
      : `
        <tr>
          <th>ROUND</th>
          <th>BET</th>
          <th>RESULT</th>
        </tr>
      `;

  const rows =
    tab === "ALL"
      ? state.allBets
      : state.bets;

  $("#betrows").innerHTML =
    rows
      .map(
        (item) => `
          <tr>
            <td>
              ${esc(
                tab === "ALL"
                  ? item.username
                  : "#" +
                      item.round_id,
              )}
            </td>

            <td>
              ${num(
                item.stake,
              )}
            </td>

            <td>
              <span class="pill">
                ${esc(
                  item.status,
                )}
                ${
                  item.payout
                    ? " · " +
                      num(
                        item.payout,
                      )
                    : ""
                }
              </span>
            </td>
          </tr>
        `,
      )
      .join("") ||
    `
      <tr>
        <td
          colspan="3"
          class="muted"
        >No bets yet</td>
      </tr>
    `;
}

async function request(type) {
  show(
    type === "DEPOSIT"
      ? "Demo Deposit Request"
      : "Demo Withdrawal Request",
    `
      <p>
        Virtual demo coins only.
        Admin approval required.
      </p>

      <form id="reqform">
        <label>
          Demo coins (100–25,000)

          <input
            name="amount"
            type="number"
            min="100"
            max="25000"
            step="1"
            required
            value="100"
          >
        </label>

        <label>
          Demo reference / note

          <input
            name="note"
            maxlength="300"
            required
            placeholder="Demo request reference"
          >
        </label>

        <button class="green full">
          SUBMIT REQUEST
        </button>

        <p
          class="error"
          id="formerror"
        ></p>
      </form>
    `,
  );

  $("#reqform").onsubmit =
    async (event) => {
      event.preventDefault();

      const button =
        event.target.querySelector(
          "button",
        );

      button.disabled = true;

      try {
        const data =
          Object.fromEntries(
            new FormData(
              event.target,
            ),
          );

        await api(
          "request",
          {
            type,
            amount: Number(
              data.amount,
            ),
            note: data.note,
          },
        );

        modal.close();

        toast(
          "Demo request submitted",
        );

        await refresh();
      } catch (error) {
        $("#formerror").textContent =
          error.message;
      } finally {
        button.disabled = false;
      }
    };
}

function info(kind) {
  if (kind === "rules") {
    show(
      "Rules",
      `<p class="rules">
        ${esc(config.rules)}
      </p>`,
    );
  }

  if (kind === "bonus") {
    show(
      "Bonus Information",
      `
        ${bonuses()}

        <p>
          Welcome: ${pct(
            "welcome",
          )}% on the first
          approved demo deposit.
        </p>

        <p>
          Promo: ${pct(
            "promo",
          )}% of the first
          approved demo deposit,
          once per code.
        </p>

        <p>
          Losing: ${pct(
            "losing",
          )}% of each lost
          demo stake.
        </p>
      `,
    );
  }

  if (kind === "promo") {
    show(
      "Promo Code",
      `
        <form id="promoform">
          <label>
            Enter promo code

            <input
              name="code"
              required
              maxlength="30"
            >
          </label>

          <button class="green full">
            APPLY CODE
          </button>

          <p
            class="error"
            id="formerror"
          ></p>
        </form>
      `,
    );

    $("#promoform").onsubmit =
      async (event) => {
        event.preventDefault();

        const button =
          event.target.querySelector(
            "button",
          );

        button.disabled = true;

        try {
          await api(
            "promo",
            {
              code:
                new FormData(
                  event.target,
                ).get("code"),
            },
          );

          modal.close();

          toast(
            "Demo promo bonus credited",
          );

          await refresh();
        } catch (error) {
          $("#formerror").textContent =
            error.message;
        } finally {
          button.disabled = false;
        }
      };
  }
}

async function account() {
  const data =
    await api(
      "account",
    );

  show(
    "Account History",
    `
      <h3>Requests</h3>

      <div class="tablewrap">
        <table>
          <tr>
            <th>TYPE</th>
            <th>COINS</th>
            <th>STATUS</th>
          </tr>

          ${
            data.requests
              .map(
                (item) => `
                  <tr>
                    <td>
                      ${esc(
                        item.type,
                      )}
                    </td>

                    <td>
                      ${num(
                        item.amount,
                      )}
                    </td>

                    <td>
                      ${esc(
                        item.status,
                      )}
                    </td>
                  </tr>
                `,
              )
              .join("") ||
            "<tr><td>No requests yet</td></tr>"
          }
        </table>
      </div>

      <h3>Coin Statement</h3>

      <div class="tablewrap">
        <table>
          ${
            data.ledger
              .map(
                (item) => `
                  <tr>
                    <td>
                      ${esc(
                        item.note,
                      )}

                      <small>
                        ${esc(
                          new Date(
                            item.created.replace(
                              " ",
                              "T",
                            ) + "Z",
                          ).toLocaleString(
                            "en-IN",
                            {
                              timeZone:
                                "Asia/Kolkata",
                            },
                          ),
                        )}
                        IST
                      </small>
                    </td>

                    <td>
                      ${num(
                        item.amount,
                      )}
                    </td>
                  </tr>
                `,
              )
              .join("") ||
            "<tr><td>No transactions yet</td></tr>"
          }
        </table>
      </div>
    `,
  );
}

const sections = [
  "Dashboard",
  "Customers",
  "Demo Coins",
  "Deposit Requests",
  "Withdrawal Requests",
  "Bonus Settings",
  "Promo Codes",
  "Game History",
  "Rules",
  "Support Settings",
];

const requestTable = (
  rows,
) => `
  <div class="tablewrap">
    <table>
      <thead>
        <tr>
          <th>Customer</th>
          <th>Demo Coins</th>
          <th>Type / Note</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody>
        ${
          rows
            .map(
              (item) => `
                <tr>
                  <td>
                    ${esc(
                      item.username,
                    )}
                  </td>

                  <td>
                    ${num(
                      item.amount,
                    )}
                  </td>

                  <td>
                    ${esc(
                      item.type,
                    )}

                    <small>
                      ${esc(
                        item.note,
                      )}
                    </small>
                  </td>

                  <td>
                    <span class="pill">
                      ${esc(
                        item.status,
                      )}
                    </span>
                  </td>

                  <td>
                    ${
                      item.status ===
                      "PENDING"
                        ? `
                          <button
                            class="green mini"
                            data-review="${item.id},SUCCESS"
                          >Approve</button>

                          <button
                            class="wine mini"
                            data-review="${item.id},REJECTED"
                          >Reject</button>
                        `
                        : "Completed"
                    }
                  </td>
                </tr>
              `,
            )
            .join("") ||
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

function roundsTable() {
  return `
    <div class="tablewrap">
      <table>
        <tr>
          <th>Round ID</th>
          <th>Multiplier</th>
          <th>Status</th>
        </tr>

        ${
          adminData.rounds
            .map(
              (item) => `
                <tr>
                  <td>
                    SF${item.id}
                  </td>

                  <td class="teal">
                    ${item.mult.toFixed(2)}x
                  </td>

                  <td>Completed</td>
                </tr>
              `,
            )
            .join("") ||
          "<tr><td>No completed rounds</td></tr>"
        }
      </table>
    </div>
  `;
}

function settingsForm() {
  const current =
    adminData.settings;

  return `
    <form id="settingsform">
      <div class="formgrid">
        ${[
          [
            "welcome",
            "Welcome Bonus %",
          ],
          [
            "promo",
            "Promo Code Bonus %",
          ],
          [
            "losing",
            "Losing Bonus %",
          ],
        ]
          .map(
            ([key, title]) => `
              <label>
                ${title}

                <input
                  name="${key}"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value="${esc(
                    current[key],
                  )}"
                  required
                >
              </label>
            `,
          )
          .join("")}
      </div>

      <label>
        Promo code

        <input
          name="promoCode"
          value="${esc(
            current.promoCode,
          )}"
          pattern="[A-Z0-9_-]{3,30}"
          required
        >
      </label>

      <label>
        Rules

        <textarea
          name="rules"
          rows="5"
          maxlength="4000"
        >${esc(
          current.rules,
        )}</textarea>
      </label>

      <label>
        24/7 support link
        (WhatsApp / Telegram)

        <input
          name="support"
          type="url"
          value="${esc(
            current.support,
          )}"
          placeholder="https://wa.me/91..."
        >
      </label>

      <button class="wine">
        SAVE SETTINGS
      </button>

      <p
        class="error"
        id="formerror"
      ></p>
    </form>
  `;
}

async function renderAdmin() {
  adminData =
    await api(
      "admin/data",
    );

  config =
    adminData.settings;

  app.innerHTML = `
    <div class="adminshell">
      <aside>
        ${logo()}

        <h4>ADMIN PANEL</h4>

        <nav>
          ${sections
            .map(
              (
                title,
                index,
              ) => `
                <button
                  class="${
                    page ===
                    title
                      ? "green"
                      : ""
                  }"
                  data-section="${index}"
                >${esc(
                  title,
                )}</button>
              `,
            )
            .join("")}
        </nav>

        <button
          data-logout
          class="outline full"
        >LOGOUT</button>
      </aside>

      <main class="adminmain">
        <header>
          <h1>
            ${esc(page)}
          </h1>

          <span class="pill">
            DEMO MODE
          </span>

          <button
            data-adminrefresh
            class="mini green"
          >Refresh</button>
        </header>

        <div
          id="admincontent"
        ></div>

        <footer>
          Virtual demo coins only
        </footer>
      </main>
    </div>
  `;

  const data =
    adminData;

  let html = "";

  if (
    page ===
    "Dashboard"
  ) {
    const stats = [
      [
        "Total Customers",
        data.users.length,
      ],
      [
        "Demo Coins Issued",
        data.coins,
      ],
      [
        "Pending Deposits",
        data.requests.filter(
          (item) =>
            item.type ===
              "DEPOSIT" &&
            item.status ===
              "PENDING",
        ).length,
      ],
      [
        "Pending Withdrawals",
        data.requests.filter(
          (item) =>
            item.type ===
              "WITHDRAWAL" &&
            item.status ===
              "PENDING",
        ).length,
      ],
    ];

    html = `
      <h2>
        SUPER FAST AVIATOR ADMIN
      </h2>

      <p class="muted">
        Virtual demo management
      </p>

      <div class="stats">
        ${stats
          .map(
            (
              [title, value],
            ) => `
              <div class="card">
                <span>
                  ${title}
                </span>

                <b>
                  ${num(
                    value,
                  )}
                </b>
              </div>
            `,
          )
          .join("")}
      </div>

      <div class="admingrid">
        <section class="card">
          <h2>
            Recent Requests
          </h2>

          ${requestTable(
            data.requests.slice(
              0,
              5,
            ),
          )}
        </section>

        <section class="card">
          <h2>
            Bonus Settings
          </h2>

          ${[
            [
              "welcome",
              "Welcome Bonus",
            ],
            [
              "promo",
              "Promo Code Bonus",
            ],
            [
              "losing",
              "Losing Bonus",
            ],
          ]
            .map(
              (
                [key, title],
              ) => `
                <div class="settingrow">
                  <b>
                    ${title}
                  </b>

                  <strong>
                    ${pct(key)}%
                  </strong>
                </div>
              `,
            )
            .join("")}

          <button
            class="wine full"
            data-section="5"
          >EDIT SETTINGS</button>
        </section>

        <section class="card">
          <h2>
            Recent Game Rounds
          </h2>

          ${roundsTable()}
        </section>

        <section class="card">
          <h2>
            Customer Support
          </h2>

          <h3>
            24/7 CUSTOMER SUPPORT
          </h3>

          <p>
            ${
              data.settings.support
                ? "Support link configured"
                : "Configure your support link"
            }
          </p>

          <button
            class="green full"
            data-section="9"
          >MANAGE</button>
        </section>
      </div>
    `;
  } else if (
    [
      "Customers",
      "Demo Coins",
    ].includes(page)
  ) {
    html = `
      <section class="card">
        <h2>
          Customer Accounts
        </h2>

        <div class="tablewrap">
          <table>
            <tr>
              <th>Customer</th>
              <th>Demo Coins</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>

            ${
              data.users
                .map(
                  (user) => `
                    <tr>
                      <td>
                        ${esc(
                          user.username,
                        )}
                      </td>

                      <td>
                        ${num(
                          user.balance,
                        )}
                      </td>

                      <td>
                        ${
                          user.blocked
                            ? "BLOCKED"
                            : "ACTIVE"
                        }
                      </td>

                      <td>
                        <button
                          class="green mini"
                          data-credit="${user.id}"
                        >Add Coins</button>

                        <button
                          class="wine mini"
                          data-block="${user.id},${
                            user.blocked
                              ? 0
                              : 1
                          }"
                        >
                          ${
                            user.blocked
                              ? "Unblock"
                              : "Block"
                          }
                        </button>
                      </td>
                    </tr>
                  `,
                )
                .join("") ||
              `
                <tr>
                  <td>
                    No customers.
                    Sign up on the
                    customer page first.
                  </td>
                </tr>
              `
            }
          </table>
        </div>
      </section>
    `;
  } else if (
    page.includes(
      "Requests",
    )
  ) {
    const type =
      page.startsWith(
        "Deposit",
      )
        ? "DEPOSIT"
        : "WITHDRAWAL";

    html = `
      <section class="card">
        <h2>
          ${esc(page)}
        </h2>

        ${requestTable(
          data.requests.filter(
            (item) =>
              item.type ===
              type,
          ),
        )}
      </section>
    `;
  } else if (
    page ===
    "Game History"
  ) {
    html = `
      <section class="card">
        <h2>
          Completed Rounds
        </h2>

        ${roundsTable()}
      </section>
    `;
  } else {
    html = `
      <section class="card">
        <h2>
          ${esc(page)}
        </h2>

        ${settingsForm()}
      </section>
    `;
  }

  $("#admincontent").innerHTML =
    html;

  if (
    $("#settingsform")
  ) {
    $("#settingsform").onsubmit =
      async (event) => {
        event.preventDefault();

        const data =
          Object.fromEntries(
            new FormData(
              event.target,
            ),
          );

        for (
          const key of
          [
            "welcome",
            "promo",
            "losing",
          ]
        ) {
          data[key] =
            Number(
              data[key],
            );
        }

        try {
          await api(
            "admin/settings",
            data,
          );

          toast(
            "Settings saved",
          );

          await renderAdmin();
        } catch (error) {
          $("#formerror").textContent =
            error.message;
        }
      };
  }
}

app.addEventListener(
  "click",
  async (event) => {
    const button =
      event.target.closest(
        "button",
      );

    if (
      !button ||
      button.disabled
    ) {
      return;
    }

    try {
      if (
        button.dataset.auth
      ) {
        auth(
          button.dataset.auth,
        );
      } else if (
        button.hasAttribute(
          "data-support",
        )
      ) {
        support();
      } else if (
        button.hasAttribute(
          "data-logout",
        )
      ) {
        await api(
          "logout",
          {},
        );

        me = null;
        state = null;

        if (
          adminRoute
        ) {
          adminLoginScreen();
        } else {
          welcome();
        }
      } else if (
        button.dataset.request
      ) {
        request(
          button.dataset.request,
        );
      } else if (
        button.dataset.info
      ) {
        info(
          button.dataset.info,
        );
      } else if (
        button.hasAttribute(
          "data-account",
        )
      ) {
        await account();
      } else if (
        button.dataset.step
      ) {
        const value =
          Number(
            button.dataset.step,
          );

        const number =
          Math.abs(
            value,
          );

        const input =
          $(
            "#stake" +
              number,
          );

        input.value =
          Math.max(
            100,
            Math.min(
              25000,
              Number(
                input.value,
              ) +
                (
                  value > 0
                    ? 100
                    : -100
                ),
            ),
          );
      } else if (
        button.dataset.quick
      ) {
        const [
          number,
          value,
        ] =
          button.dataset.quick.split(
            ",",
          );

        $(
          "#stake" +
            number,
        ).value =
          value;
      } else if (
        button.dataset.tab
      ) {
        tab =
          button.dataset.tab;

        for (
          const item of
          document.querySelectorAll(
            "[data-tab]",
          )
        ) {
          item.classList.toggle(
            "green",
            item ===
              button,
          );
        }

        renderBets();
      } else if (
        button.dataset.bet
      ) {
        if (
          !state
        ) {
          return;
        }

        busy = true;
        button.disabled =
          true;

        const number =
          Number(
            button.dataset.bet,
          );

        const bet =
          state.bets.find(
            (item) =>
              item.round_id ===
                state.round.id &&
              item.panel ===
                number &&
              item.status ===
                "ACTIVE",
          );

        try {
          if (
            bet
          ) {
            await api(
              "cashout",
              {
                id:
                  bet.id,
              },
            );
          } else {
            await api(
              "bet",
              {
                amount:
                  Number(
                    $(
                      "#stake" +
                        number,
                    ).value,
                  ),
                panel:
                  number,
                roundId:
                  state.round.id,
              },
            );
          }
        } finally {
          busy =
            false;

          await refresh();
        }
      } else if (
        button.dataset.section !==
        undefined
      ) {
        page =
          sections[
            Number(
              button.dataset.section,
            )
          ];

        await renderAdmin();
      } else if (
        button.hasAttribute(
          "data-adminrefresh",
        )
      ) {
        await renderAdmin();
      } else if (
        button.dataset.review
      ) {
        const [
          id,
          status,
        ] =
          button.dataset.review.split(
            ",",
          );

        button.disabled =
          true;

        await api(
          "admin/request",
          {
            id:
              Number(id),
            status,
          },
        );

        toast(
          "Request updated",
        );

        await renderAdmin();
      } else if (
        button.dataset.block
      ) {
        const [
          id,
          blocked,
        ] =
          button.dataset.block.split(
            ",",
          );

        await api(
          "admin/customer",
          {
            id:
              Number(id),
            action:
              "block",
            blocked:
              Number(
                blocked,
              ),
          },
        );

        await renderAdmin();
      } else if (
        button.dataset.credit
      ) {
        const id =
          Number(
            button.dataset.credit,
          );

        show(
          "Add Demo Coins",
          `
            <form id="creditform">
              <label>
                Demo coins

                <input
                  name="amount"
                  type="number"
                  min="100"
                  max="25000"
                  value="1000"
                  required
                >
              </label>

              <button class="green full">
                CREDIT DEMO COINS
              </button>

              <p
                id="formerror"
                class="error"
              ></p>
            </form>
          `,
        );

        $("#creditform").onsubmit =
          async (event) => {
            event.preventDefault();

            const submit =
              event.target.querySelector(
                "button",
              );

            submit.disabled =
              true;

            try {
              const form =
                new FormData(
                  event.target,
                );

              await api(
                "admin/customer",
                {
                  id,
                  action:
                    "credit",
                  amount:
                    Number(
                      form.get(
                        "amount",
                      ),
                    ),
                },
              );

              modal.close();

              await renderAdmin();
            } catch (error) {
              $("#formerror").textContent =
                error.message;
            } finally {
              submit.disabled =
                false;
            }
          };
      }
    } catch (error) {
      toast(
        error.message,
      );

      if (
        adminRoute &&
        me
      ) {
        await renderAdmin().catch(
          () => {},
        );
      }
    }
  },
);

async function init() {
  try {
    config =
      await api(
        "public",
      );

    me = (
      await api(
        "me",
      )
    ).user;

    if (
      adminRoute
    ) {
      if (
        me?.role ===
        "admin"
      ) {
        await renderAdmin();
      } else {
        adminLoginScreen();
      }
    } else if (
      me?.role ===
      "customer"
    ) {
      renderGame();

      await refresh();
    } else {
      welcome();
    }
  } catch (error) {
    app.innerHTML = `
      <p class="error">
        Unable to connect.
        Refresh to retry.
      </p>
    `;

    toast(
      error.message,
    );
  }
}

await init();

setInterval(
  () => refresh(),
  500,
);

document.addEventListener(
  "visibilitychange",
  () => {
    if (
      !document.hidden
    ) {
      refresh();
    }
  },
);
