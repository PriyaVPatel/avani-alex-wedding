/**
 * Avani & Alex — RSVP backend (Google Apps Script, container-bound)
 * ------------------------------------------------------------------
 * Open the guest-list Google Sheet → Extensions → Apps Script → paste
 * this file → Deploy → New deployment → Web app:
 *    Execute as:        Me
 *    Who has access:    Anyone
 * Copy the /exec URL into app.js (API_URL).
 *
 * SHEET LAYOUT (two tabs):
 *
 * Tab "Guests" — one row per guest:
 *   PartyID | PartyName | GuestName |
 *   Invited_mehndi | Invited_vidhi | Invited_rehearsal | Invited_wedding | Invited_reception |
 *   RSVP_mehndi | RSVP_vidhi | RSVP_rehearsal | RSVP_wedding | RSVP_reception |
 *   Meal | Note | SubmittedAt
 *   (Invited_* cells: TRUE/FALSE checkboxes. RSVP_* cells get "Yes"/"No".)
 *
 * Tab "Events" — one row per event (details live HERE, not in the site
 * code, so only invited guests ever receive them):
 *   EventID | Title | DateLabel | TimeLabel | Venue | Address | MapURL | Attire | Details | Order
 *   EventID must match the Invited_/RSVP_ column suffixes:
 *   mehndi, vidhi, rehearsal, wedding, reception
 */

const GUESTS_TAB = "Guests";
const EVENTS_TAB = "Events";

/* ============================ GET: lookup ============================ */

function doGet(e) {
  try {
    const action = (e.parameter.action || "").toLowerCase();
    if (action !== "lookup") return jsonOut({ ok: false, error: "bad_action" });

    const rawName = (e.parameter.name || "").trim();
    if (!rawName) return jsonOut({ ok: false, error: "missing_name" });

    const data = readGuests();
    const target = normalize(rawName);

    // exact match first, then "contains" as a fallback
    let hit = data.rows.find((r) => normalize(r.GuestName) === target);
    if (!hit) hit = data.rows.find((r) => normalize(r.GuestName).indexOf(target) !== -1);
    if (!hit) return jsonOut({ ok: false, error: "not_found" });

    const partyRows = data.rows.filter((r) => String(r.PartyID) === String(hit.PartyID));
    const eventIds = getEventIds(data.headers);

    const guests = partyRows.map((r) => {
      const invited = eventIds.filter((id) => truthy(r["Invited_" + id]));
      const rsvp = {};
      eventIds.forEach((id) => {
        const v = r["RSVP_" + id];
        if (v === "Yes" || v === "No") rsvp[id] = v;
      });
      return { name: r.GuestName, invited: invited, rsvp: rsvp, meal: r.Meal || "" };
    });

    // union of everything anyone in the party is invited to
    const invitedUnion = {};
    guests.forEach((g) => g.invited.forEach((id) => (invitedUnion[id] = true)));

    const events = readEvents().filter((ev) => invitedUnion[ev.id]);

    return jsonOut({
      ok: true,
      party: {
        id: hit.PartyID,
        name: partyRows[0].PartyName || "",
        note: partyRows[0].Note || "",
        guests: guests,
      },
      events: events,
    });
  } catch (err) {
    return jsonOut({ ok: false, error: "server_error", detail: String(err) });
  }
}

/* ============================ POST: submit =========================== */

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.action !== "submit") return jsonOut({ ok: false, error: "bad_action" });

    const sheet = SpreadsheetApp.getActive().getSheetByName(GUESTS_TAB);
    const data = readGuests();
    const eventIds = getEventIds(data.headers);
    const col = (name) => data.headers.indexOf(name) + 1; // 1-based
    const stamp = new Date();

    (payload.guests || []).forEach((g) => {
      const rowIdx = data.rows.findIndex(
        (r) =>
          String(r.PartyID) === String(payload.partyId) &&
          normalize(r.GuestName) === normalize(g.name)
      );
      if (rowIdx === -1) return;
      const sheetRow = rowIdx + 2; // +1 for header, +1 for 1-based

      eventIds.forEach((id) => {
        // Only write RSVPs for events this guest is actually invited to
        if (!truthy(data.rows[rowIdx]["Invited_" + id])) return;
        const v = g.rsvp && g.rsvp[id];
        if (v === "Yes" || v === "No") {
          sheet.getRange(sheetRow, col("RSVP_" + id)).setValue(v);
        }
      });

      if (col("Meal") > 0 && typeof g.meal === "string") {
        sheet.getRange(sheetRow, col("Meal")).setValue(g.meal);
      }
      if (col("Note") > 0) {
        sheet.getRange(sheetRow, col("Note")).setValue(payload.note || "");
      }
      if (col("SubmittedAt") > 0) {
        sheet.getRange(sheetRow, col("SubmittedAt")).setValue(stamp);
      }
    });

    return jsonOut({ ok: true });
  } catch (err) {
    return jsonOut({ ok: false, error: "server_error", detail: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ============================== helpers ============================== */

function readGuests() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(GUESTS_TAB);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const rows = values.slice(1).filter((r) => r[headers.indexOf("GuestName")]).map((r) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = r[i]));
    return obj;
  });
  return { headers: headers, rows: rows };
}

function readEvents() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(EVENTS_TAB);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idx = (h) => headers.indexOf(h);
  return values
    .slice(1)
    .filter((r) => r[idx("EventID")])
    .map((r) => ({
      id: String(r[idx("EventID")]).trim(),
      title: r[idx("Title")],
      date: r[idx("DateLabel")],
      time: r[idx("TimeLabel")],
      venue: r[idx("Venue")],
      address: r[idx("Address")],
      mapUrl: r[idx("MapURL")],
      attire: r[idx("Attire")],
      details: r[idx("Details")],
      order: Number(r[idx("Order")]) || 0,
    }));
}

function getEventIds(headers) {
  return headers
    .filter((h) => h.indexOf("Invited_") === 0)
    .map((h) => h.replace("Invited_", ""));
}

function normalize(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function truthy(v) {
  return v === true || String(v).toUpperCase() === "TRUE" || v === 1 || v === "1" || String(v).toLowerCase() === "yes";
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
