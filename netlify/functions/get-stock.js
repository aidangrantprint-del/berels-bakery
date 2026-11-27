/**
 * Tells the browser how many of each item are left (from Airtable), so the
 * menu can show "Sold out" / "Only N left" and cap the amounts. Never exposes
 * the Airtable token. The response is cached on Netlify's CDN for 60 s to stay
 * inside Airtable's free-plan limit (~1,000 API calls a month); checkout and
 * the payment webhook always read fresh numbers.
 *
 * Reply: { counts: { white_sourdough: 4, ... } } — keys with a blank count
 * are left out (= no limit). {} counts if Airtable isn't set up.
 */
const { loadCounts } = require("./utils/airtable");

exports.handler = async function () {
  const result = await loadCounts();
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=60, stale-while-revalidate=60",
    },
    body: JSON.stringify({ counts: result ? result.counts : {} }),
  };
};
