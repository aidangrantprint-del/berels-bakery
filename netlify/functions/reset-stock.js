/**
 * Weekly stock reset — a Netlify SCHEDULED function (schedule in netlify.toml).
 * At 12:00am Monday Melbourne time, every Airtable row's "In stock" goes back
 * to its "Weekly amount" (rows with a blank Weekly amount are left alone).
 *
 * Netlify's cron runs on UTC, and Melbourne is UTC+11 in daylight saving
 * (Oct–Apr) or UTC+10 otherwise, so netlify.toml wakes this at BOTH Sunday
 * 13:00 and 14:00 UTC; it only resets on the run where it's actually Monday
 * 00:xx in Melbourne. Scheduled functions can't be triggered from a browser
 * on the live site. Results show in Netlify → Logs → Functions → reset-stock.
 */
const { resetToWeekly } = require("./utils/airtable");

function melbourneNow(date) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "short", hour: "numeric", hourCycle: "h23",
  }).formatToParts(date || new Date());
  const get = function (t) { const p = parts.find(function (x) { return x.type === t; }); return p ? p.value : ""; };
  return { weekday: get("weekday"), hour: Number(get("hour")) };
}

exports.handler = async function () {
  const now = melbourneNow();
  if (!(now.weekday === "Mon" && now.hour === 0)) {
    console.log("Not Monday midnight in Melbourne (" + now.weekday + " " + now.hour + ":00) — skipping.");
    return { statusCode: 200, body: "skipped" };
  }
  const result = await resetToWeekly();
  if (result.ok) {
    console.log("Weekly stock reset:", result.reset.map(function (r) { return r.key + "=" + r.to; }).join(", ") || "(no Weekly amounts set)");
    return { statusCode: 200, body: "reset" };
  }
  console.error("Weekly stock reset FAILED:", result.error);
  return { statusCode: 500, body: "reset failed" };
};

exports.melbourneNow = melbourneNow;
