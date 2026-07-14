/* =====================================================================
   Avani & Alex — RSVP frontend
   Talks to a Google Apps Script Web App backed by the guest-list Sheet.
   ===================================================================== */

/* ------------------------- CONFIG — EDIT ME -------------------------- */

// 1) Paste your deployed Apps Script Web App URL here (ends in /exec):
const API_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";

// 2) Reception dinner — three plated options, entrée + side are paired
//    and served together (one selection per guest, required):
const MEAL_OPTIONS = [
  {
    value: "Chicken",
    label: "Herb-Roasted Free-Range Chicken",
    pairing: "served with an herb-roasted petite potato medley",
  },
  {
    value: "Salmon",
    label: "Pan-Seared Faroe Island Salmon",
    pairing: "served with herb-roasted heirloom carrots",
  },
  {
    value: "Vegan",
    label: "Crispy Tofu & Wok-Fried Seasonal Vegetables",
    pairing: "with jasmine rice and Hunan sauce (vegan)",
  },
];

// 3) Which event the meal selection applies to (matches EventID in the Sheet):
const MEAL_EVENT_ID = "reception";

/* --------------------------------------------------------------------- */

/* --------------------------- password gate ---------------------------- */
// The password is not stored here in plain text — only hashes of its
// lowercased form, so the check is case-insensitive (CHIPnealpatel,
// chipNEALpatel, etc. all work).
const GATE_SHA256 = "6c7099e6df0cfb4c7f81058d9a02c353641849298d6a0b608e41e80aa2d106d4";
const GATE_DJB2 = "3952173023";
const GATE_KEY = "aa_gate_v1";

function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return String(h >>> 0);
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function unlockSite(remember) {
  document.body.classList.remove("locked");
  if (remember) {
    try { localStorage.setItem(GATE_KEY, GATE_DJB2); } catch (e) { /* private mode */ }
  }
}

(function initGate() {
  try {
    if (localStorage.getItem(GATE_KEY) === GATE_DJB2) { unlockSite(false); return; }
  } catch (e) { /* localStorage unavailable — just show the gate */ }

  const form = document.querySelector("#gate-form");
  const input = document.querySelector("#gate-pass");
  const msg = document.querySelector("#gate-msg");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const guess = input.value.trim().toLowerCase();
    if (!guess) return;

    let ok = false;
    if (window.crypto && crypto.subtle) {
      try { ok = (await sha256hex(guess)) === GATE_SHA256; } catch (err) { ok = djb2(guess) === GATE_DJB2; }
    } else {
      ok = djb2(guess) === GATE_DJB2;
    }

    if (ok) {
      unlockSite(true);
    } else {
      msg.textContent = "That's not quite it — check your invitation and try again.";
      input.select();
    }
  });
})();


const $ = (sel) => document.querySelector(sel);

const lookupSection = $("#rsvp-lookup");
const partySection  = $("#rsvp-party");
const doneSection   = $("#rsvp-done");
const lookupForm    = $("#lookup-form");
const lookupMsg     = $("#lookup-msg");
const lookupBtn     = $("#lookup-btn");

let state = null; // { party, events }

/* ------------------------------ nav ---------------------------------- */
const navToggle = document.querySelector(".nav-toggle");
const navLinks  = document.querySelector(".nav-links");
navToggle.addEventListener("click", () => {
  const open = navLinks.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(open));
});
navLinks.addEventListener("click", (e) => {
  if (e.target.tagName === "A") navLinks.classList.remove("open");
});

/* ----------------------------- lookup -------------------------------- */
lookupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#guest-name").value.trim();
  if (!name) return;

  if (API_URL.startsWith("PASTE_")) {
    lookupMsg.textContent =
      "RSVP isn't connected yet — the Apps Script URL still needs to be added to app.js.";
    return;
  }

  lookupBtn.disabled = true;
  lookupMsg.innerHTML = '<span class="spinner"></span> Finding your invitation…';

  try {
    const res = await fetch(
      `${API_URL}?action=lookup&name=${encodeURIComponent(name)}`,
      { method: "GET", redirect: "follow" }
    );
    const data = await res.json();

    if (!data.ok) {
      lookupMsg.textContent =
        data.error === "not_found"
          ? "We couldn't find that name — try the exact spelling from your invitation, or contact us below."
          : "Something went wrong on our end. Please try again in a moment.";
      lookupBtn.disabled = false;
      return;
    }

    if (data.multiple) {
      lookupMsg.textContent = "";
      lookupBtn.disabled = false;
      renderChoices(name, data.choices);
      return;
    }

    // Single match: still confirm the household before opening the RSVP form
    lookupMsg.textContent = "";
    lookupBtn.disabled = false;
    state = data;
    renderConfirm();
  } catch (err) {
    console.error(err);
    lookupMsg.textContent = "We couldn't reach the RSVP service. Check your connection and try again.";
    lookupBtn.disabled = false;
  }
});

/* ------------------ confirm household (single match) ------------------ */
function renderConfirm() {
  const { party } = state;
  lookupSection.hidden = true;
  doneSection.hidden = true;
  partySection.hidden = false;

  partySection.innerHTML = `
    <p class="party-name">We found your invitation</p>
    <p class="party-sub">Please confirm this is your group before continuing.</p>
    <div class="choice-list">
      <div class="choice-item confirm">
        <span>
          <strong>${esc(party.name || "Your party")}</strong><br />
          <small>${party.guests.map((g) => esc(g.name)).join(" · ")}</small>
        </span>
      </div>
    </div>
    <div class="submit-row">
      <button class="btn btn-emerald" id="confirm-btn">This is my party — continue</button>
      <button class="btn btn-ghost" id="confirm-back">Not us — search again</button>
    </div>
  `;

  $("#confirm-btn").addEventListener("click", renderParty);
  $("#confirm-back").addEventListener("click", () => {
    state = null;
    partySection.hidden = true;
    lookupSection.hidden = false;
    $("#guest-name").focus();
  });

  partySection.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* --------------------- duplicate-name disambiguation ------------------ */
function renderChoices(name, choices) {
  lookupSection.hidden = true;
  doneSection.hidden = true;
  partySection.hidden = false;

  partySection.innerHTML = `
    <p class="party-name">Which one is you?</p>
    <p class="party-sub">More than one guest shares that name — pick your household below.</p>
    <div class="choice-list">
      ${choices
        .map(
          (c, i) => `
        <label class="choice-item">
          <input type="radio" name="party-choice" value="${esc(c.partyId)}" ${i === 0 ? "checked" : ""} />
          <span>
            <strong>${esc(c.partyName || "Party " + c.partyId)}</strong><br />
            <small>${c.members.map(esc).join(" · ")}</small>
          </span>
        </label>`
        )
        .join("")}
    </div>
    <div class="submit-row">
      <button class="btn btn-emerald" id="choice-btn">This is my party</button>
      <button class="btn btn-ghost" id="choice-back">Back</button>
      <p class="form-msg" id="choice-msg" role="status"></p>
    </div>
  `;

  $("#choice-back").addEventListener("click", () => {
    partySection.hidden = true;
    lookupSection.hidden = false;
  });

  $("#choice-btn").addEventListener("click", async () => {
    const picked = partySection.querySelector('input[name="party-choice"]:checked');
    if (!picked) return;
    const msg = $("#choice-msg");
    msg.innerHTML = '<span class="spinner"></span> Loading your invitation…';
    try {
      const res = await fetch(
        `${API_URL}?action=lookup&name=${encodeURIComponent(name)}&party=${encodeURIComponent(picked.value)}`,
        { method: "GET", redirect: "follow" }
      );
      const data = await res.json();
      if (!data.ok || data.multiple) throw new Error(data.error || "lookup_failed");
      state = data;
      renderParty();
    } catch (err) {
      console.error(err);
      msg.textContent = "We couldn't load that party — please try again.";
    }
  });

  partySection.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* --------------------------- render party ---------------------------- */
function renderParty() {
  const { party, events } = state;
  lookupSection.hidden = true;
  doneSection.hidden = true;
  partySection.hidden = false;

  const sorted = [...events].sort((a, b) => (a.order || 0) - (b.order || 0));

  let html = `
    <p class="party-name">${esc(party.name || "Your party")}</p>
    <p class="party-sub">Here is your personal schedule. Please reply for each guest and each event.</p>
  `;

  for (const ev of sorted) {
    const invitedGuests = party.guests.filter((g) => g.invited.includes(ev.id));
    if (!invitedGuests.length) continue;

    html += `
      <div class="event-card" data-event="${esc(ev.id)}">
        <h4>${esc(ev.title)}</h4>
        <p class="event-when">${esc(ev.date)}${ev.time ? " · " + esc(ev.time) : ""}</p>
        <p class="event-meta">
          <strong>${esc(ev.venue || "")}</strong>
          ${ev.address ? "<br />" + esc(ev.address) : ""}
          ${ev.mapUrl ? ` · <a href="${esc(ev.mapUrl)}" target="_blank" rel="noopener">Map</a>` : ""}
        </p>
        ${ev.attire ? `<p class="event-attire">Attire: ${esc(ev.attire)}</p>` : ""}
        ${ev.details ? `<p class="event-details">${esc(ev.details)}</p>` : ""}
        <div class="guest-rows">
          ${invitedGuests.map((g) => guestRow(g, ev.id)).join("")}
        </div>
      </div>
    `;
  }

  // Meal block — only for guests invited to the meal event
  const mealGuests = party.guests.filter((g) => g.invited.includes(MEAL_EVENT_ID));
  if (mealGuests.length) {
    html += `
      <div class="meal-block">
        <h4>Reception dinner</h4>
        <p class="fine">Each plate is served as a set — please read the three
        options, then make one selection per guest.</p>
        <ul class="menu-list">
          ${MEAL_OPTIONS.map(
            (m) => `
            <li>
              <span class="menu-entree">${esc(m.label)}</span>
              <span class="menu-pairing">${esc(m.pairing)}</span>
            </li>`
          ).join("")}
        </ul>
        ${mealGuests
          .map(
            (g) => `
          <div class="meal-row">
            <span>${esc(g.name)}</span>
            <select data-meal="${esc(g.name)}">
              <option value="">Select a plate…</option>
              ${MEAL_OPTIONS.map(
                (m) =>
                  `<option value="${esc(m.value)}"${g.meal === m.value ? " selected" : ""}>${esc(m.label)}</option>`
              ).join("")}
            </select>
          </div>`
          )
          .join("")}
      </div>
    `;
  }

  html += `
    <div class="note-block">
      <label for="party-note">Anything we should know? (allergies, accessibility, song requests…)</label>
      <textarea id="party-note">${esc(party.note || "")}</textarea>
    </div>
    <div class="submit-row">
      <button class="btn btn-emerald" id="submit-btn">Send our RSVP</button>
      <p class="form-msg" id="submit-msg" role="status"></p>
    </div>
  `;

  partySection.innerHTML = html;

  // wire up pills
  partySection.querySelectorAll(".pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.closest(".pill-group");
      group.querySelectorAll(".pill").forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
    });
  });

  $("#submit-btn").addEventListener("click", submitRsvp);
  partySection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function guestRow(guest, eventId) {
  const current = (guest.rsvp && guest.rsvp[eventId]) || "";
  return `
    <div class="guest-row" data-guest="${esc(guest.name)}" data-event="${esc(eventId)}">
      <span class="g-name">${esc(guest.name)}</span>
      <span class="pill-group" role="group" aria-label="RSVP for ${esc(guest.name)}">
        <button type="button" class="pill yes" aria-pressed="${current === "Yes"}">Joyfully accepts</button>
        <button type="button" class="pill no" aria-pressed="${current === "No"}">Regretfully declines</button>
      </span>
    </div>
  `;
}

/* ----------------------------- submit -------------------------------- */
async function submitRsvp() {
  const msg = $("#submit-msg");
  const btn = $("#submit-btn");

  // collect answers
  const answers = {};
  let missing = 0;
  partySection.querySelectorAll(".guest-row").forEach((row) => {
    const guest = row.dataset.guest;
    const event = row.dataset.event;
    const yes = row.querySelector(".pill.yes").getAttribute("aria-pressed") === "true";
    const no  = row.querySelector(".pill.no").getAttribute("aria-pressed") === "true";
    if (!yes && !no) { missing++; return; }
    answers[guest] = answers[guest] || {};
    answers[guest][event] = yes ? "Yes" : "No";
  });

  if (missing > 0) {
    msg.textContent = "Please answer accept / decline for every guest and event before sending.";
    return;
  }

  const meals = {};
  partySection.querySelectorAll("select[data-meal]").forEach((sel) => {
    meals[sel.dataset.meal] = sel.value;
  });

  // Meal is required for anyone who accepted the reception
  const missingMeal = state.party.guests.filter(
    (g) =>
      g.invited.includes(MEAL_EVENT_ID) &&
      answers[g.name] &&
      answers[g.name][MEAL_EVENT_ID] === "Yes" &&
      !meals[g.name]
  );
  if (missingMeal.length) {
    msg.textContent = `Please choose a dinner plate (chicken, salmon, or the vegan tofu) for: ${missingMeal
      .map((g) => g.name)
      .join(", ")}.`;
    return;
  }

  const payload = {
    action: "submit",
    partyId: state.party.id,
    note: $("#party-note").value.trim(),
    guests: state.party.guests.map((g) => ({
      name: g.name,
      rsvp: answers[g.name] || {},
      meal: meals[g.name] || "",
    })),
  };

  btn.disabled = true;
  msg.innerHTML = '<span class="spinner"></span> Sending…';

  try {
    // NOTE: no Content-Type header on purpose — keeps this a "simple"
    // request so the browser doesn't preflight (Apps Script can't answer
    // CORS preflights).
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify(payload),
      redirect: "follow",
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "submit_failed");

    partySection.hidden = true;
    doneSection.hidden = false;
    doneSection.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (err) {
    console.error(err);
    msg.textContent = "We couldn't save your RSVP — please try again, or contact us below.";
    btn.disabled = false;
  }
}

/* ------------------------------ utils -------------------------------- */
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
