/* =====================================================================
   Avani & Alex — RSVP frontend
   Talks to a Google Apps Script Web App backed by the guest-list Sheet.
   ===================================================================== */

/* ------------------------- CONFIG — EDIT ME -------------------------- */

// 1) Paste your deployed Apps Script Web App URL here (ends in /exec):
const API_URL = "https://script.google.com/macros/s/AKfycbwsCdkLmEN_LgTPmXQOsxFxVMbe5SAmzBNvrlFf3CM5czzFjWIRk7V6XBlUG_BR6upZQw/exec";

// 2) Meal choices for the reception dinner (one per guest, required):
const MEAL_OPTIONS = [
  "Chicken",
  "Salmon",
  "Vegan",
];

// 3) Which event the meal selection applies to (matches EventID in the Sheet):
const MEAL_EVENT_ID = "reception";

/* --------------------------------------------------------------------- */

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

    state = data;
    lookupMsg.textContent = "";
    lookupBtn.disabled = false;
    renderParty();
  } catch (err) {
    console.error(err);
    lookupMsg.textContent = "We couldn't reach the RSVP service. Check your connection and try again.";
    lookupBtn.disabled = false;
  }
});

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
        <h4>Dinner preference</h4>
        <p class="fine">For the reception dinner — one selection per guest.</p>
        ${mealGuests
          .map(
            (g) => `
          <div class="meal-row">
            <span>${esc(g.name)}</span>
            <select data-meal="${esc(g.name)}">
              <option value="">Select a meal…</option>
              ${MEAL_OPTIONS.map(
                (m) => `<option value="${esc(m)}"${g.meal === m ? " selected" : ""}>${esc(m)}</option>`
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
      <button class="btn btn-maroon" id="submit-btn">Send our RSVP</button>
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
    msg.textContent = `Please choose a dinner (chicken, salmon, or vegan) for: ${missingMeal
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
