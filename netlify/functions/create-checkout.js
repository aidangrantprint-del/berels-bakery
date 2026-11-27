/**
 * Creates a Stripe Checkout Session for the customer's cart and returns the
 * URL to redirect them to. Prices are recalculated here from utils/pricing.js
 * — never trusted from the browser.
 */
const { computeOrder, MENU_ITEMS } = require("./utils/pricing");
const { loadSoldOut, loadLimits } = require("./utils/stock");
const { loadCounts, shortages, groupKey } = require("./utils/airtable");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Online payment isn't set up yet (missing STRIPE_SECRET_KEY)." }),
    };
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request." }) };
  }

  const siteOrigin = process.env.URL || ("https://" + (event.headers.host || ""));
  const [stock, limits, airtable] = await Promise.all([
    loadSoldOut(siteOrigin), loadLimits(siteOrigin), loadCounts(),
  ]);
  const counts = airtable ? airtable.counts : {}; // Airtable "In stock" (fresh)

  const { lines, total } = computeOrder(data.cart, data.addons, limits, counts);

  // Anything requested that didn't survive the order limits (a pack size that's
  // been switched off, or more than the current maximum) — refuse with a message
  // rather than silently charging for less than they asked for.
  const requested = data.cart && typeof data.cart === "object" ? data.cart : {};
  for (const id of Object.keys(requested)) {
    if (!(Number(requested[id]) > 0)) continue;
    if (!lines.some(function (l) { return l.id === id; })) {
      const item = MENU_ITEMS.find(function (m) { return m.id === id; });
      const itemName = item ? item.name : "item";
      const left = counts[groupKey(id.replace(/-/g, "_"))];
      if (typeof left === "number" && Number(requested[id]) > left) {
        return {
          statusCode: 409,
          body: JSON.stringify({ error: left <= 0
            ? "Sorry, the " + itemName + " has just sold out, so it's been taken out of your cart. Please check your order and try again."
            : "Sorry, we only have " + left + " left of the " + itemName + ", so your cart has been adjusted. Please check your order and try again." }),
        };
      }
      return {
        statusCode: 409,
        body: JSON.stringify({ error: "Sorry, the amount of " + (item ? item.name : "an item") + " in your cart isn't available any more, so it's been adjusted. Please check your order and try again." }),
      };
    }
  }

  if (lines.length === 0 || total <= 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Your cart is empty." }) };
  }

  // Refuse anything Asher has switched to sold out (products.json, edited at /admin).
  for (const line of lines) {
    const key = line.id.replace(/-/g, "_");
    if (stock[key] === true) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: "Sorry, the " + line.name + " has just sold out, so it's been taken out of your cart. Please check your order and try again." }),
      };
    }
    if (line.note && stock[key + "_icing"] === true) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: "Sorry, the cream cheese icing has just sold out, so it's been taken off your scrolls. Please check your order and try again." }),
      };
    }
  }

  // Not enough left in Airtable (e.g. more iced scrolls than icing left).
  const short = shortages(lines, counts);
  if (short.length) {
    const k = short[0].key;
    const what = k.endsWith("_icing") ? "cream cheese icing"
      : k === "sourdough" ? "sourdough loaves (White and Seeded together)"
      : "of that item";
    return {
      statusCode: 409,
      body: JSON.stringify({ error: "Sorry, we only have " + short[0].left + " " + what + " left, so your cart has been adjusted. Please check your order and try again." }),
    };
  }

  const name = String(data.name || "").trim().slice(0, 200);
  const contactMethod = data.contactMethod === "phone" ? "phone" : "email";
  const contact = String(data.contact || "").trim().slice(0, 200);
  const notes = String(data.notes || "").trim().slice(0, 400);

  const origin = process.env.URL || ("https://" + (event.headers.host || ""));
  const successUrl = origin + "/order-success.html?session_id={CHECKOUT_SESSION_ID}";
  const cancelUrl = origin + "/menu.html#order";

  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", successUrl);
  params.append("cancel_url", cancelUrl);
  // Payment page expires after 31 min (Stripe's minimum is 30) instead of the
  // default 24 h, so an old page can't be paid long after something sells out.
  params.append("expires_at", String(Math.floor(Date.now() / 1000) + 31 * 60));
  if (contactMethod === "email" && contact) {
    params.append("customer_email", contact);
  }
  params.append("metadata[name]", name);
  params.append("metadata[contact_method]", contactMethod);
  params.append("metadata[contact]", contact);
  params.append("metadata[notes]", notes);
  params.append("metadata[items_json]", JSON.stringify(lines.map(function (l) {
    return { id: l.id, name: l.name, qty: l.qty, lineTotal: l.lineTotal, note: l.note };
  })).slice(0, 490));
  params.append("metadata[total]", total.toFixed(2));

  lines.forEach(function (line, i) {
    const label = line.qty + " x " + line.name + (line.note ? " (+ " + line.note + ")" : "");
    params.append("line_items[" + i + "][price_data][currency]", "aud");
    params.append("line_items[" + i + "][price_data][product_data][name]", label.slice(0, 250));
    params.append("line_items[" + i + "][price_data][unit_amount]", String(Math.round(line.lineTotal * 100)));
    params.append("line_items[" + i + "][quantity]", "1");
  });

  try {
    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + secretKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      console.error("Stripe error:", session);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: (session.error && session.error.message) || "Stripe couldn't create the checkout session." }),
      };
    }

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error("Checkout creation failed:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Something went wrong starting checkout." }) };
  }
};
