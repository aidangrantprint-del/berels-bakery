/**
 * Stripe webhook: Stripe calls this directly (server to server) when a
 * Checkout payment succeeds, so every paid order is logged to the Google
 * Sheet + emailed even if the customer closes the tab before the success page.
 *
 * Setup: Stripe → Developers → Webhooks → endpoint
 *   https://berelsbakery.com/.netlify/functions/stripe-webhook
 * listening to checkout.session.completed and
 * checkout.session.async_payment_succeeded; its signing secret (whsec_…) goes
 * in the Netlify env var STRIPE_WEBHOOK_SECRET.
 *
 * The success page still sends its own copy as a backup; the Apps Script skips
 * duplicates by Stripe session id, so the order is only recorded once.
 */
const crypto = require("crypto");
const { loadSoldOut, soldOutProblems } = require("./utils/stock");

// Same Apps Script web app as ORDER_ENDPOINT in js/main.js (keep in sync).
const ORDER_ENDPOINT = "https://script.google.com/macros/s/AKfycbzo_p_47rVAGjdnOUn2vjfydi2P71WgVQzSpl0TNM_Tc_hqMLBiaeM09_AD-gxTmkdN/exec";

/* Checks the Stripe-Signature header (HMAC-SHA256 of "<timestamp>.<raw body>"). */
function verifyStripeSignature(rawBody, header, secret, toleranceSeconds) {
  if (!header) return false;
  let timestamp = null;
  const signatures = [];
  header.split(",").forEach(function (part) {
    const idx = part.indexOf("=");
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === "t") timestamp = v;
    if (k === "v1") signatures.push(v);
  });
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;

  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(timestamp + "." + rawBody, "utf8").digest("hex"),
    "utf8"
  );
  return signatures.some(function (sig) {
    const given = Buffer.from(sig, "utf8");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set — can't verify Stripe webhooks.");
    return { statusCode: 500, body: "Webhook not configured" };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : (event.body || "");
  const headers = event.headers || {};
  const sigHeader = headers["stripe-signature"] || headers["Stripe-Signature"];

  if (!verifyStripeSignature(rawBody, sigHeader, secret, 300)) {
    console.error("Stripe webhook signature check failed.");
    return { statusCode: 400, body: "Bad signature" };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch (err) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const handled = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  if (handled.indexOf(stripeEvent.type) === -1) {
    return { statusCode: 200, body: "Ignored " + stripeEvent.type };
  }

  const session = (stripeEvent.data && stripeEvent.data.object) || {};
  if (session.payment_status !== "paid") {
    // e.g. a delayed payment method — the async_payment_succeeded event follows.
    return { statusCode: 200, body: "Not paid yet" };
  }

  const meta = session.metadata || {};
  let items = [];
  let itemsUnreadable = false;
  try { items = JSON.parse(meta.items_json || "[]"); } catch (err) { itemsUnreadable = true; }

  const origin = process.env.URL || "https://berelsbakery.com";
  const problems = soldOutProblems(items, await loadSoldOut(origin));
  const warnings = [];
  if (problems.length) {
    warnings.push("SOLD OUT when paid: " + problems.join(", ") + " — refund or contact the customer");
  }
  if (itemsUnreadable) {
    warnings.push("Item list couldn't be read — check this payment in Stripe");
  }

  const total = session.amount_total != null ? session.amount_total / 100 : Number(meta.total || 0);
  const payload = {
    timestamp: new Date().toISOString(),
    name: meta.name || (session.customer_details && session.customer_details.name) || "",
    contactMethod: meta.contact_method || "",
    contact: meta.contact || (session.customer_details && session.customer_details.email) || "",
    notes: meta.notes || "",
    items: items,
    total: total,
    paidOnline: true,
    sessionId: session.id,
    warning: warnings.join(" | "),
    source: "stripe-webhook",
  };

  try {
    const res = await fetch(ORDER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let reply = {};
    try { reply = JSON.parse(text); } catch (e) { /* not JSON */ }
    if (!res.ok || reply.ok !== true) {
      console.error("Apps Script didn't confirm the order:", res.status, text.slice(0, 300));
      return { statusCode: 500, body: "Order logging failed — Stripe will retry" };
    }
    console.log("Order logged for", session.id, reply.duplicate ? "(already recorded)" : "", payload.warning || "");
    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error("Couldn't reach Apps Script:", err);
    return { statusCode: 500, body: "Order logging failed — Stripe will retry" };
  }
};
