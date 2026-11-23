/**
 * Creates a Stripe Checkout Session for the customer's cart and returns the
 * URL to redirect them to. Prices are recalculated here from utils/pricing.js
 * — never trusted from the browser.
 */
const { computeOrder } = require("./utils/pricing");

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

  const { lines, total } = computeOrder(data.cart, data.addons);
  if (lines.length === 0 || total <= 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Your cart is empty." }) };
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
