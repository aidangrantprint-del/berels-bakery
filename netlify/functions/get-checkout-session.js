/**
 * Looks up a Stripe Checkout Session by id and reports whether it was paid,
 * plus the order details stored in its metadata. Called by order-success.html
 * after Stripe redirects the customer back.
 */
const { loadSoldOut, soldOutProblems } = require("./utils/stock");

exports.handler = async function (event) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const sessionId = event.queryStringParameters && event.queryStringParameters.session_id;

  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Online payment isn't set up yet." }) };
  }
  if (!sessionId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing session_id." }) };
  }

  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId), {
      headers: { "Authorization": "Bearer " + secretKey },
    });
    const session = await res.json();
    if (!res.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: (session.error && session.error.message) || "Couldn't look up that payment." }),
      };
    }

    const meta = session.metadata || {};
    let items = [];
    try { items = JSON.parse(meta.items_json || "[]"); } catch (err) { items = []; }

    return {
      statusCode: 200,
      body: JSON.stringify({
        paid: session.payment_status === "paid",
        name: meta.name || "",
        contactMethod: meta.contact_method || "",
        contact: meta.contact || "",
        notes: meta.notes || "",
        items: items,
        total: meta.total || (session.amount_total != null ? (session.amount_total / 100).toFixed(2) : "0.00"),
        // Anything in this order that's currently switched to sold out (so the
        // success page can tell the customer, and flag it in the Sheet/email).
        soldOut: session.payment_status === "paid"
          ? soldOutProblems(items, await loadSoldOut(process.env.URL || "https://berelsbakery.com"))
          : [],
      }),
    };
  } catch (err) {
    console.error("Session lookup failed:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Something went wrong verifying payment." }) };
  }
};
