import {
  flightPoint,
  elapsedAt,
  GameAudio,
} from "/flight.js?v=20261106-customerpromo";

const $ = (selector) =>
  document.querySelector(selector);

const app = $("#app");
const modal = $("#modal");

let me = null;
let config = {};
let state = null;
let busy = false;
let tab = "ALL";
let refreshing = false;

const gameAudio = new GameAudio();

let flightSnapshot = null;
let flightReceivedAt = 0;
let flightFrame = 0;

function stopFlight() {
  gameAudio.reset();

  if (flightFrame) {
    cancelAnimationFrame(flightFrame);
  }

  flightFrame = 0;
  flightSnapshot = null;
}

function startFlight() {
  stopFlight();

  function draw() {
    const plane = $("#flyingplane");
    const trail = $("#flighttrail");

    if (!plane || !trail) {
      stopFlight();
      return;
    }

    const snapshot = flightSnapshot || {
      phase: "WAITING",
      elapsedMs: 0,
    };

    const point = flightPoint(
      elapsedAt(
        snapshot,
        flightReceivedAt,
        performance.now(),
      ),
    );

    plane.style.left =
      `${point.x / 600 * 100}%`;

    plane.style.top =
      `${point.y / 250 * 100}%`;

    plane.style.transform =
      `translate(-50%, -50%) rotate(${point.angle.toFixed(2)}deg)`;

    plane.classList.toggle(
      "flying",
      snapshot.phase === "FLYING",
    );

    plane.classList.toggle(
      "gone",
      snapshot.phase === "CRASHED",
    );

    trail.setAttribute(
      "d",
      snapshot.phase === "WAITING"
        ? "M 70 215"
        : point.path,
    );

    if (
      document.hidden ||
      performance.now() -
        flightReceivedAt > 2000
    ) {
      gameAudio.stopEngine();
    }

    flightFrame =
      requestAnimationFrame(draw);
  }

  draw();
}

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
  "₹" +
  Number(value || 0).toLocaleString(
    "en-IN",
  );

const pct = (key) =>
  esc(config[key] ?? 10);

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");

  setTimeout(() => {
    $("#toast").classList.remove("visible");
  }, 4000);
}

async function api(route, data) {
  const response = await fetch(
    "/api/" + route,
    {
      method: data ? "POST" : "GET",

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

  const result = await response.json();

  if (!response.ok) {
    if (
      response.status === 401 &&
      route !== "login" &&
      route !== "signup"
    ) {
      me = null;
      state = null;

      if (modal.open) {
        modal.close();
      }

      welcome();
    }

    throw new Error(result.error);
  }

  return result;
}

function logo() {
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

function bonuses() {
  const items = [
    ["welcome", "WELCOME<br>BONUS"],
    ["promo", "PROMO CODE<br>BONUS"],
    ["losing", "LOSING<br>BONUS"],
  ];

  return `
    <div class="bonusrow">
      ${items.map(
        ([key, title]) => `
          <div class="bonus">
            <b>${pct(key)}%</b>
            <span>${title}</span>
          </div>
        `,
      ).join("")}
    </div>
  `;
}

function whatsappIcon() {
  return `
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      style="vertical-align:middle;margin-right:8px;flex-shrink:0"
    >
      <path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.5-4.8A8.5 8.5 0 1 1 20.5 11.5Z"/>
      <path d="M8.2 7.3c.3-.2.7-.2.9.2l.8 1.8c.1.3 0 .5-.2.7l-.6.6c.7 1.4 1.8 2.5 3.3 3.2l.6-.7c.2-.2.4-.3.7-.2l1.8.9c.3.2.4.5.3.8-.3 1-1.1 1.6-2.1 1.5-3.7-.5-6.7-3.4-7.1-7.1-.1-.8.6-1.5 1.6-1.7Z"/>
    </svg>
  `;
}

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
      `
        <p>
          The administrator has not
          configured a support link yet.
        </p>
      `,
    );
  }
}

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

function welcome() {
  stopFlight();

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
        >${whatsappIcon()}24/7 CUSTOMER SUPPORT</button>

        <p class="muted demofoot">
          Simulation balance
        </p>
      </div>
    </main>
  `;
}

function signupWhatsApp() {
  let url;

  try {
    url = new URL(String(config.support || ""));
  } catch {
    toast("Admin must configure a WhatsApp support link before signup.");
    return;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "wa.me" ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/[1-9][0-9]{7,14}\/?$/.test(url.pathname)
  ) {
    toast("Admin must configure a WhatsApp link with country code, such as https://wa.me/91XXXXXXXXXX.");
    return;
  }

  const chat = new URL("https://wa.me" + url.pathname);
  chat.searchParams.set(
    "text",
    "Hello, I would like to request a Super Fast Aviator customer ID.",
  );
  window.location.assign(chat.href);
}

function auth(mode = "login") {
  if (mode === "signup") {
    signupWhatsApp();
    return;
  }

  show(
    "Customer Login",
    `
      <form id="authform">
        <label>
          Customer ID

          <input
            name="username"
            autocomplete="username"
            required
            pattern="[a-zA-Z0-9._\\-]{4,30}"
            minlength="4"
            maxlength="30"
          >
        </label>

        <label>
          Password

          <input
            name="password"
            type="password"
            autocomplete="current-password"
            minlength="8"
            maxlength="128"
            required
          >
        </label>

        <p class="muted">
          Customer accounts only.
          Admin uses a separate /admin link.
        </p>

        <button
          class="green full"
          type="submit"
        >LOGIN</button>

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

      if (button.disabled) {
        return;
      }

      button.disabled = true;

      try {
        const data =
          Object.fromEntries(
            new FormData(event.target),
          );

        const result = await api("login", data);

        me = result.user;
        modal.close();

        if (me.mustChangePassword) {
          changePassword(true);
          return;
        }

        renderGame();
        await refresh();
      } catch (error) {
        if ($("#formerror")) {
          $("#formerror").textContent =
            error.message;
        }
      } finally {
        button.disabled = false;
      }
    };
}

function changePassword(
  required = false,
) {
  show(
    required
      ? "Change Temporary Password"
      : "Change Password",
    `
      <p>
        ${
          required
            ? "Your admin-created ID requires a new password before using the game."
            : "Changing your password ends existing customer sessions."
        }
      </p>

      <form id="passwordform">
        <label>
          Current Password

          <input
            name="currentPassword"
            type="password"
            autocomplete="current-password"
            required
            maxlength="128"
          >
        </label>

        <label>
          New Password

          <input
            name="newPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            required
          >
        </label>

        <label>
          Confirm New Password

          <input
            name="confirmPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            required
          >
        </label>

        <button
          type="submit"
          class="green full"
        >SAVE PASSWORD</button>

        <p
          class="error"
          id="formerror"
        ></p>
      </form>
    `,
  );

  $("#passwordform").onsubmit =
    async (event) => {
      event.preventDefault();

      const button =
        event.target.querySelector(
          "button",
        );

      if (button.disabled) {
        return;
      }

      button.disabled = true;

      try {
        await api(
          "password",
          Object.fromEntries(
            new FormData(event.target),
          ),
        );

        me = null;
        state = null;

        modal.close();
        welcome();

        toast(
          "Password changed. Log in with the new password.",
        );
      } catch (error) {
        if ($("#formerror")) {
          $("#formerror").textContent =
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
          <span>AMOUNT</span>
        </div>

        <div class="stake">
          <button
            data-step="-${number}"
            aria-label="Decrease bet ${number}"
          >−</button>

          <div class="stakevalue">
            <span
              class="stakecurrency"
              aria-hidden="true"
            >₹</span>

            <input
              id="stake${number}"
              type="number"
              min="10"
              max="25000"
              step="1"
              value="10"
              aria-label="Bet ${number} stake"
            >
          </div>

          <button
            data-step="${number}"
            aria-label="Increase bet ${number}"
          >+</button>
        </div>

        <div class="quick">
          ${[10, 100, 500, 1000].map(
            (coins) => `
              <button
                data-quick="${number},${coins}"
              >${coins}</button>
            `,
          ).join("")}
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
  stopFlight();

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

          <button data-logout>Logout</button>
        </div>
      </nav>

      <header class="gamehead">
        ${logo()}

        <button
          class="mini outline"
          data-sound
          aria-label="${
            gameAudio.enabled
              ? "Turn sound off"
              : "Turn sound on"
          }"
          title="${
            gameAudio.enabled
              ? "Sound ON"
              : "Sound OFF"
          }"
          aria-pressed="${gameAudio.enabled}"
        >${gameAudio.enabled ? "🔊" : "🔇"}</button>

        <div class="balance">
          <b id="balance">
            ${num(me.balance)}
          </b>

          <small>
            BALANCE ·
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

        <div class="flightplot">
          <svg
            viewBox="0 0 600 250"
            preserveAspectRatio="none"
            class="trail"
            aria-hidden="true"
          >
            <path
              id="flighttrail"
              d="M 70 215"
            />
          </svg>

          <img
            id="flyingplane"
            src="/plane.svg"
            alt="Flying airplane"
          >
        </div>

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
        <span>Simulation balance</span>

        <button
          data-account
        >History</button>

        <button
          data-password
        >Password</button>

        <button
          data-logout
        >Logout</button>

        <button
          data-support
          aria-label="Customer support"
        >${whatsappIcon()}24/7 Support</button>
      </footer>
    </main>
  `;

  startFlight();

  $("#menutoggle").onclick = () => {
    const menu = $("#gamemenu");

    menu.hidden = !menu.hidden;

    $("#menutoggle").setAttribute(
      "aria-expanded",
      String(!menu.hidden),
    );
  };
}

async function refresh() {
  if (
    !me ||
    busy ||
    refreshing ||
    !$("#balance")
  ) {
    return;
  }

  refreshing = true;

  try {
    const snapshot = await api("state");

    if (!me || !$("#balance")) {
      return;
    }

    state = snapshot;
    me = state.user;

    $("#balance").textContent =
      num(me.balance);

    $("#history").innerHTML =
      state.history.map(
        (item, index) => `
          <span
            class="${
              index % 2 ? "wine" : "green"
            }"
            title="${
              item.mode === "ADMIN"
                ? "Admin-Controlled Demo"
                : "Random Demo"
            }"
          >
            ${item.mult.toFixed(2)}x${
              item.mode === "ADMIN"
                ? " · A"
                : ""
            }
          </span>
        `,
      ).join("") ||
      "<span>First demo round</span>";

    const current = state.round;

    $("#phase").textContent =
      current.phase === "WAITING"
        ? `NEXT ROUND IN ${current.countdown}s`
        : current.phase === "FLYING"
          ? "FLYING"
          : "FLEW AWAY";

    $("#mult").textContent =
      current.phase === "WAITING"
        ? "GET READY"
        : current.mult.toFixed(2) + "x";

    $("#mult").classList.toggle(
      "crashed",
      current.phase === "CRASHED",
    );

    $("#roundid").textContent =
      "ROUND #" + current.id;

    flightSnapshot = current;
    flightReceivedAt = performance.now();

    if (!document.hidden) {
      gameAudio.sync(current);
    }

    for (const number of [1, 2]) {
      const bet = state.bets.find(
        (item) =>
          item.round_id === current.id &&
          item.panel === number,
      );

      const button = $(
        `[data-bet="${number}"]`,
      );

      button.classList.toggle(
        "wine",
        !!bet &&
          current.phase === "FLYING",
      );

      button.disabled =
        (
          !!bet &&
          (
            bet.status !== "ACTIVE" ||
            current.phase !== "FLYING"
          )
        ) ||
        (
          !bet &&
          current.phase !== "WAITING"
        );

      if (
        bet &&
        bet.status === "ACTIVE" &&
        current.phase === "FLYING"
      ) {
        button.innerHTML = `
          CASH OUT

          <small>
            ${num(
              Math.floor(
                bet.stake * current.mult,
              ),
            )}
            AMOUNT
          </small>
        `;
      } else if (bet) {
        button.innerHTML = `
          ${
            bet.status === "ACTIVE"
              ? "BET PLACED"
              : bet.status
          }

          <small>
            ${num(bet.stake)}
            AMOUNT
          </small>
        `;
      } else {
        button.innerHTML =
          current.phase === "WAITING"
            ? "BET<small>AMOUNT</small>"
            : "NEXT ROUND";
      }
    }

    renderBets();
  } catch {
    gameAudio.reset();

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
  } finally {
    refreshing = false;
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
    rows.map(
      (item) => `
        <tr>
          <td>
            ${esc(
              tab === "ALL"
                ? item.username
                : "#" + item.round_id,
            )}
          </td>

          <td>${num(item.stake)}</td>

          <td>
            <span class="pill">
              ${esc(item.status)}

              ${
                item.payout
                  ? " · " + num(item.payout)
                  : ""
              }
            </span>
          </td>
        </tr>
      `,
    ).join("") ||
    `
      <tr>
        <td
          colspan="3"
          class="muted"
        >No bets yet</td>
      </tr>
    `;
}

async function readImage(file) {
  if (!file?.size) {
    return null;
  }

  if (file.size > 1500000) {
    throw new Error(
      "Proof image must be under 1.5 MB.",
    );
  }

  return new Promise(
    (resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () =>
        resolve(reader.result);

      reader.onerror = () =>
        reject(
          new Error(
            "Unable to read image",
          ),
        );

      reader.readAsDataURL(file);
    },
  );
}

async function request(type) {
  config = await api("public");

  const deposit = type === "DEPOSIT";
  const minimum = deposit ? 100 : 300;

  const bankFields = [
    ["Account Holder", config.bankHolder],
    ["Bank", config.bankName],
    ["Account Number", config.bankAccount],
    ["IFSC", config.bankIfsc],
    ["UPI ID", config.upiId],
  ];

  const payment = `
    <div class="bankdetails">
      <h3>Admin Deposit Details</h3>

      ${bankFields
        .filter(([, value]) => value)
        .map(
          ([label, value]) => `
            <p>
              <b>${label}:</b>
              ${esc(value)}
            </p>
          `,
        )
        .join("")}

      ${
        config.qrImageId
          ? `
            <img
              class="qrpreview"
              src="/api/media/${esc(
                config.qrImageId,
              )}"
              alt="Admin deposit QR"
            >
          `
          : ""
      }

      <p>
        ${esc(
          config.depositInstructions ||
            "Contact support if deposit details have not been configured.",
        )}
      </p>
    </div>
  `;

  show(
    deposit
      ? "Deposit Request"
      : "Withdrawal Request",
    `
      ${deposit ? payment : ""}

      <form id="reqform">
        <label>
          Amount (₹${minimum}–₹25,000)

          <input
            name="amount"
            type="number"
            min="${minimum}"
            max="25000"
            step="1"
            value="${minimum}"
            required
          >
        </label>

        ${
          deposit
            ? `
              <label>
                UTR / Reference

                <input
                  name="utr"
                  maxlength="100"
                  required
                >
              </label>

              <label>
                Proof Image
                (optional, max 1.5 MB)

                <input
                  name="proofFile"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                >
              </label>
            `
            : `
              <label>
                Account Holder

                <input
                  name="holder"
                  maxlength="120"
                  required
                >
              </label>

              <label>
                Bank Name

                <input
                  name="bank"
                  maxlength="120"
                  required
                >
              </label>

              <label>
                Account Number

                <input
                  name="account"
                  inputmode="numeric"
                  pattern="[0-9]{6,22}"
                  required
                >
              </label>

              <label>
                Confirm Account Number

                <input
                  name="confirmAccount"
                  inputmode="numeric"
                  pattern="[0-9]{6,22}"
                  required
                >
              </label>

              <label>
                IFSC

                <input
                  name="ifsc"
                  maxlength="11"
                  required
                >
              </label>

              <p class="muted">
                The withdrawal amount will be held on
                submission. Rejection restores
                the held coins.
              </p>
            `
        }

        <label>
          Note (optional)

          <input
            name="note"
            maxlength="300"
          >
        </label>

        <button
          type="submit"
          class="green full"
        >SUBMIT REQUEST</button>

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

      if (button.disabled) {
        return;
      }

      button.disabled = true;

      try {
        const formData =
          Object.fromEntries(
            new FormData(event.target),
          );

        const proof = deposit
          ? await readImage(
              event.target.querySelector(
                "[name=proofFile]",
              ).files[0],
            )
          : null;

        const result = await api(
          "request",
          {
            type,
            amount: Number(formData.amount),
            note: formData.note,
            utr: formData.utr,
            proof,
            holder: formData.holder,
            bank: formData.bank,
            account: formData.account,
            confirmAccount:
              formData.confirmAccount,
            ifsc: formData.ifsc,
          },
        );

        modal.close();

        toast(
          "Request #" +
            result.id +
            " sent to admin — PENDING",
        );

        await refresh();
      } catch (error) {
        if ($("#formerror")) {
          $("#formerror").textContent =
            error.message;
        }
      } finally {
        button.disabled = false;
      }
    };
}

async function info(kind) {
  config = await api("public");
  if (kind === "rules") {
    show(
      "Rules",
      `
        <p class="rules">
          ${esc(config.rules)}
        </p>
      `,
    );
  }

  if (kind === "bonus") {
    show(
      "Bonus Information",
      `
        ${bonuses()}

        <p>
          Welcome:
          ${pct("welcome")}%
          added only by admin after review.
          Deposit approval does not add this bonus automatically.
        </p>

        <p>
          Promo:
          ${pct("promo")}%
          added only by admin.
          Checking a promo code does not credit the balance.
        </p>

        <p>
          Losing:
          ${pct("losing")}%
          reviewed by admin when losses reach ₹10,000 or more.
          Admin enters the bonus amount manually.
          Losing a bet never adds this bonus automatically.
        </p>
      `,
    );
  }

  if (kind === "promo") {
    const result = await api("me");
    if (!result.user || result.user.role !== "customer") return;
    me = result.user;
    const promoCode = me.promoCode || "";
    show(
      "Promo Code",
      `
        <form id="promoform">
          <label>
            Admin Promo Code

            <input
              name="code"
              value="${esc(promoCode)}"
              readonly
              required
              maxlength="30"
            >
          </label>

          <button
            class="green full"
            ${promoCode ? "" : "disabled"}
          >CHECK CODE</button>
          ${promoCode ? "" : '<p class="muted">Admin has not assigned a promo code to your ID yet. Contact Customer Support.</p>'}

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
          const result = await api(
            "promo",
            {
              code: new FormData(
                event.target,
              ).get("code"),
            },
          );

          modal.close();

          toast(result.message || "Contact admin for the promo bonus.");

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
  const data = await api("account");

  show(
    "Account History",
    `
      <h3>Requests</h3>

      <div class="tablewrap">
        <table>
          <tr>
            <th>TYPE</th>
            <th>AMOUNT</th>
            <th>STATUS</th>
          </tr>

          ${
            data.requests.map(
              (item) => `
                <tr>
                  <td>
                    ${esc(item.type)}
                  </td>

                  <td>
                    ${num(item.amount)}
                  </td>

                  <td>
                    ${esc(item.status)}

                    <small>
                      ${esc(
                        item.admin_note || "",
                      )}
                    </small>

                    ${
                      item.proof_id
                        ? `
                          <a
                            href="/api/media/${esc(
                              item.proof_id,
                            )}"
                            target="_blank"
                            rel="noopener"
                          >View proof</a>
                        `
                        : ""
                    }
                  </td>
                </tr>
              `,
            ).join("") ||
            `
              <tr>
                <td>No requests yet</td>
              </tr>
            `
          }
        </table>
      </div>

      <h3>Account Statement</h3>

      <div class="tablewrap">
        <table>
          ${
            data.ledger.map(
              (item) => `
                <tr>
                  <td>
                    ${esc(item.note)}

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
                    ${num(item.amount)}
                  </td>
                </tr>
              `,
            ).join("") ||
            `
              <tr>
                <td>No transactions yet</td>
              </tr>
            `
          }
        </table>
      </div>
    `,
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
      if (button.dataset.auth) {
        auth(button.dataset.auth);
      } else if (
        button.hasAttribute(
          "data-sound",
        )
      ) {
        await gameAudio.toggle();

        button.textContent =
          gameAudio.enabled
            ? "🔊"
            : "🔇";

        button.title =
          gameAudio.enabled
            ? "Sound ON"
            : "Sound OFF";

        button.setAttribute(
          "aria-label",
          gameAudio.enabled
            ? "Turn sound off"
            : "Turn sound on",
        );

        toast(
          gameAudio.enabled
            ? "Sound ON"
            : "Sound OFF",
        );

        if (gameAudio.enabled) {
          gameAudio.tone(
            880,
            880,
            0.18,
            0.08,
          );
        }

        button.setAttribute(
          "aria-pressed",
          String(gameAudio.enabled),
        );

        if (
          gameAudio.enabled &&
          state?.round &&
          !document.hidden
        ) {
          gameAudio.sync(state.round);
        }
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
        await api("logout", {});

        me = null;
        state = null;

        welcome();
      } else if (
        button.hasAttribute(
          "data-password",
        )
      ) {
        changePassword();
      } else if (
        button.dataset.request
      ) {
        await request(
          button.dataset.request,
        );
      } else if (
        button.dataset.info
      ) {
        await info(button.dataset.info);
      } else if (
        button.hasAttribute(
          "data-account",
        )
      ) {
        await account();
      } else if (
        button.dataset.step
      ) {
        const step = Number(
          button.dataset.step,
        );

        const number =
          Math.abs(step);

        const input = $(
          "#stake" + number,
        );

        input.value = Math.max(
          10,
          Math.min(
            25000,
            Number(input.value) +
              (step > 0 ? 10 : -10),
          ),
        );
      } else if (
        button.dataset.quick
      ) {
        const [number, value] =
          button.dataset.quick.split(",");

        $("#stake" + number).value =
          value;
      } else if (
        button.dataset.tab
      ) {
        tab = button.dataset.tab;

        for (
          const item of
          document.querySelectorAll(
            "[data-tab]",
          )
        ) {
          item.classList.toggle(
            "green",
            item === button,
          );
        }

        renderBets();
      } else if (
        button.dataset.bet
      ) {
        if (!state) {
          return;
        }

        busy = true;
        button.disabled = true;

        const number = Number(
          button.dataset.bet,
        );

        const bet = state.bets.find(
          (item) =>
            item.round_id ===
              state.round.id &&
            item.panel === number &&
            item.status === "ACTIVE",
        );

        try {
          if (bet) {
            await api(
              "cashout",
              {
                id: bet.id,
              },
            );

            gameAudio.cashout();
          } else {
            await api(
              "bet",
              {
                amount: Number(
                  $(
                    "#stake" + number,
                  ).value,
                ),

                panel: number,
                roundId: state.round.id,
              },
            );
          }
        } finally {
          busy = false;
          await refresh();
        }
      }
    } catch (error) {
      toast(error.message);
    }
  },
);

async function init() {
  try {
    config = await api("public");

    me = (
      await api("me")
    ).user;

    if (me?.role === "customer") {
      if (me.mustChangePassword) {
        welcome();
        changePassword(true);
      } else {
        renderGame();
        await refresh();
      }
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

    toast(error.message);
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
    if (!document.hidden) {
      refresh();
    } else {
      gameAudio.reset();
    }
  },
);
