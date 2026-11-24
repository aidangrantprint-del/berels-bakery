/**
 * Sold-out switches (products.json, edited by Asher at /admin).
 * Keys are item ids with "_" instead of "-", plus "<key>_icing" for the add-on.
 */

/* Reads the live switches from the published site. If they can't be read for
   any reason, returns {} (nothing sold out) so a glitch never blocks a sale. */
async function loadSoldOut(origin) {
  try {
    const res = await fetch(origin + "/products.json?t=" + Date.now(), {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data && typeof data === "object" ? data : {};
  } catch (err) {
    console.error("Couldn't read products.json:", err);
    return {};
  }
}

/* Given order lines ({ id, name, note }) and the switches, returns a list of
   human-readable problems, e.g. ["Choc Chunk Cookie", "cream cheese icing (Cinnamon Scroll)"]. */
function soldOutProblems(lines, stock) {
  const problems = [];
  (lines || []).forEach(function (line) {
    if (!line || !line.id) return;
    const key = String(line.id).replace(/-/g, "_");
    if (stock[key] === true) problems.push(line.name || line.id);
    else if (line.note && stock[key + "_icing"] === true) problems.push("cream cheese icing (" + (line.name || line.id) + ")");
  });
  return problems;
}

module.exports = { loadSoldOut, soldOutProblems };
