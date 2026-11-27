/**
 * Stock countdown in Airtable (base "Berel's Bakery", table "Stock").
 *
 * Fields:
 *   Item key  (primary, text) — white_sourdough, seeded_sourdough,
 *              choc_chunk_cookie, cinnamon_scroll, cinnamon_scroll_icing
 *   Name      (text, just for Asher)
 *   In stock  (whole number) — how many are left. Loaves = loaves, cookies =
 *              single cookies, scrolls = single scrolls, icing = iced scrolls.
 *              BLANK = no limit. 0 = sold out.
 *
 * Netlify env vars: AIRTABLE_TOKEN (personal access token, scopes
 * data.records:read + data.records:write, access to this base only),
 * AIRTABLE_BASE_ID (app…). Optional AIRTABLE_TABLE (defaults to the table id).
 *
 * Everything fails OPEN: if Airtable isn't set up or can't be reached, the
 * site behaves as if there's no stock limit (the /admin switches still work).
 */
const API = "https://api.airtable.com/v0/";
const DEFAULT_TABLE = "tblGQ4ctJeovlySiN"; // the "Stock" table (id survives renames)
const KEY_FIELD = "Item key";
const COUNT_FIELD = "In stock";

/* Items that share ONE stock number in Airtable. Both loaves come out of the
   same "sourdough" row. Keep in sync with STOCK_GROUPS in js/main.js. */
const STOCK_GROUPS = { white_sourdough: "sourdough", seeded_sourdough: "sourdough" };
function groupKey(key) { return STOCK_GROUPS[key] || key; }

function configured() {
  return !!(process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID);
}

function tableUrl() {
  return API + encodeURIComponent(process.env.AIRTABLE_BASE_ID) + "/" +
    encodeURIComponent(process.env.AIRTABLE_TABLE || DEFAULT_TABLE);
}

function authHeaders() {
  return { "Authorization": "Bearer " + process.env.AIRTABLE_TOKEN, "Content-Type": "application/json" };
}

/* Returns { counts: { key: number }, ids: { key: recordId } }, or null if
   Airtable isn't configured / can't be read. A blank "In stock" isn't in counts. */
async function loadCounts() {
  if (!configured()) return null;
  try {
    const url = tableUrl() + "?pageSize=100&fields%5B%5D=" + encodeURIComponent(KEY_FIELD) +
      "&fields%5B%5D=" + encodeURIComponent(COUNT_FIELD);
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      console.error("Airtable read failed:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    const counts = {};
    const ids = {};
    (data.records || []).forEach(function (r) {
      const fields = r.fields || {};
      const key = String(fields[KEY_FIELD] || "").trim();
      if (!key) return;
      ids[key] = r.id;
      const n = fields[COUNT_FIELD];
      if (typeof n === "number" && isFinite(n)) counts[key] = Math.max(0, Math.floor(n));
    });
    return { counts: counts, ids: ids };
  } catch (err) {
    console.error("Airtable read failed:", err);
    return null;
  }
}

/* How many units of each stock key an order uses. Lines are { id, qty, note }
   where note looks like "2 with cream cheese icing". */
function usageFor(lines) {
  const used = {};
  (lines || []).forEach(function (l) {
    if (!l || !l.id) return;
    const key = String(l.id).replace(/-/g, "_");
    const g = groupKey(key);
    used[g] = (used[g] || 0) + (Number(l.qty) || 0);
    const m = /^(\d+) with /.exec(l.note || "");
    if (m) used[key + "_icing"] = (used[key + "_icing"] || 0) + Number(m[1]);
  });
  return used;
}

/* Anything an order needs more of than is left: [{ key, wanted, left }]. */
function shortages(lines, counts) {
  const out = [];
  const used = usageFor(lines);
  Object.keys(used).forEach(function (key) {
    if (counts && typeof counts[key] === "number" && used[key] > counts[key]) {
      out.push({ key: key, wanted: used[key], left: counts[key] });
    }
  });
  return out;
}

/* Takes a paid order off the counts. Returns { ok, shortages } — shortages
   lists anything that was already lower than the order (oversold). Items with
   a blank count are left alone. */
async function subtractOrder(lines) {
  if (!configured()) return { ok: true, shortages: [] };
  const current = await loadCounts();
  if (!current) return { ok: false, shortages: [] };
  const used = usageFor(lines);
  const updates = [];
  Object.keys(used).forEach(function (key) {
    const left = current.counts[key];
    if (typeof left !== "number" || !current.ids[key] || !used[key]) return;
    const fields = {};
    fields[COUNT_FIELD] = Math.max(0, left - used[key]);
    updates.push({ id: current.ids[key], fields: fields });
  });
  const short = shortages(lines, current.counts);
  try {
    for (let i = 0; i < updates.length; i += 10) { // Airtable allows 10 records per request
      const res = await fetch(tableUrl(), {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ records: updates.slice(i, i + 10) }),
      });
      if (!res.ok) {
        console.error("Airtable update failed:", res.status, (await res.text()).slice(0, 300));
        return { ok: false, shortages: short };
      }
    }
    return { ok: true, shortages: short };
  } catch (err) {
    console.error("Airtable update failed:", err);
    return { ok: false, shortages: short };
  }
}

/* Weekly reset: sets "In stock" back to "Weekly amount" on every row that has
   a Weekly amount. Rows with a blank Weekly amount are left alone.
   Returns { ok, reset: [{ key, to }] }. */
const WEEKLY_FIELD = "Weekly amount";
async function resetToWeekly() {
  if (!configured()) return { ok: false, reset: [], error: "Airtable not configured" };
  try {
    const url = tableUrl() + "?pageSize=100&fields%5B%5D=" + encodeURIComponent(KEY_FIELD) +
      "&fields%5B%5D=" + encodeURIComponent(WEEKLY_FIELD);
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      console.error("Airtable read failed:", res.status, text);
      return { ok: false, reset: [], error: "read " + res.status };
    }
    const data = await res.json();
    const updates = [];
    const reset = [];
    (data.records || []).forEach(function (r) {
      const f = r.fields || {};
      const n = f[WEEKLY_FIELD];
      if (typeof n !== "number" || !isFinite(n)) return;
      const fields = {};
      fields[COUNT_FIELD] = Math.max(0, Math.floor(n));
      updates.push({ id: r.id, fields: fields });
      reset.push({ key: String(f[KEY_FIELD] || r.id), to: fields[COUNT_FIELD] });
    });
    for (let i = 0; i < updates.length; i += 10) {
      const up = await fetch(tableUrl(), {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ records: updates.slice(i, i + 10) }),
      });
      if (!up.ok) {
        console.error("Airtable reset failed:", up.status, (await up.text()).slice(0, 300));
        return { ok: false, reset: reset, error: "update " + up.status };
      }
    }
    return { ok: true, reset: reset };
  } catch (err) {
    console.error("Airtable reset failed:", err);
    return { ok: false, reset: [], error: String(err) };
  }
}

module.exports = { resetToWeekly, STOCK_GROUPS, groupKey, configured, loadCounts, usageFor, shortages, subtractOrder };
