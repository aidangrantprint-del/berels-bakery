/**
 * Server-side pricing table for Berel's Bakery.
 *
 * IMPORTANT: keep this in sync with MENU_ITEMS in js/main.js. This copy is
 * the one that actually decides how much a customer is charged — the browser
 * only ever sends item ids and quantities, never prices, so nothing here can
 * be changed by editing the page's JavaScript.
 */
const MENU_ITEMS = [
  { id: "white-sourdough",   name: "White Sourdough Loaf",  price: 8.50,  max: 2 },
  { id: "seeded-sourdough",  name: "Seeded Sourdough Loaf", price: 11.00, max: 2 },
  {
    id: "choc-chunk-cookie",
    name: "Choc Chunk Cookie",
    price: 5.00,
    packs: [1, 4, 6, 12],
    packPrices: { 1: 5.00, 4: 15.00, 6: 25.00, 12: 45.00 },
  },
  {
    id: "cinnamon-scroll",
    name: "Cinnamon Scroll",
    price: 4.50,
    packs: [1, 3, 6],
    packPrices: { 1: 4.50, 3: 12.50, 6: 23.00 },
    addOn: { label: "cream cheese icing", price: 1.50 },
  },
];

/* Order limits (limits.json, edited by Asher at /admin) can only RESTRICT what
   the code allows: switch pack sizes off, or set a per-order maximum (1–20) for
   plain items. Prices never come from limits.json. Missing/invalid values fall
   back to the defaults above. */
const MAX_LIMIT = 20;
function effectiveItem(item, limits) {
  limits = limits || {};
  const key = item.id.replace(/-/g, "_");
  const out = Object.assign({}, item);
  if (item.packs) {
    out.packs = item.packs.filter(function (p) { return limits[key + "_pack_" + p] !== false; });
  } else {
    const m = Number(limits[key + "_max"]);
    if (Number.isInteger(m) && m >= 1) out.max = Math.min(m, MAX_LIMIT);
  }
  return out;
}

function basePriceFor(item, qty) {
  if (item.packPrices && item.packPrices[qty] !== undefined) return item.packPrices[qty];
  return item.price * qty;
}

/**
 * Recomputes an order from raw cart data.
 * cartQty:    { itemId: quantity }
 * cartAddons: { itemId: count } — how many of that item's units have the
 *             optional add-on (e.g. 2 of 6 cinnamon scrolls with icing)
 * Any quantity that isn't a valid pack size (or exceeds a plain item's max) is
 * silently dropped rather than trusted. Add-on counts are clamped to the
 * item's quantity, so a customer can never be charged for more than they ordered.
 */
function computeOrder(cartQty, cartAddons, limits) {
  cartQty = cartQty || {};
  cartAddons = cartAddons || {};
  const lines = [];
  let total = 0;

  MENU_ITEMS.forEach(function (baseItem) {
    const item = effectiveItem(baseItem, limits);
    const qty = Number(cartQty[item.id] || 0);
    if (!qty || qty <= 0) return;
    if (item.packs && item.packs.indexOf(qty) === -1) return;
    if (item.max && qty > item.max) return;

    const addOnCount = item.addOn
      ? Math.min(Math.max(Number(cartAddons[item.id] || 0), 0), qty)
      : 0;
    const lineTotal = basePriceFor(item, qty) + addOnCount * (item.addOn ? item.addOn.price : 0);
    const rounded = Math.round(lineTotal * 100) / 100;

    lines.push({
      id: item.id,
      name: item.name,
      qty: qty,
      lineTotal: rounded,
      note: addOnCount > 0 ? addOnCount + " with " + item.addOn.label : null,
    });
    total += rounded;
  });

  return { lines: lines, total: Math.round(total * 100) / 100 };
}

module.exports = { MENU_ITEMS, computeOrder, effectiveItem };
