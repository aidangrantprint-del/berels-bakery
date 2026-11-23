# Online payments (Stripe) — setup

This connects the "Continue to Payment" checkout to Stripe. Prices are
recalculated on the server (`netlify/functions/utils/pricing.js`), so nothing
a customer edits in their browser can change what they're charged.

## What's already built
- `netlify/functions/create-checkout.js` — creates a Stripe Checkout Session
  for the customer's cart and returns the payment page URL.
- `netlify/functions/get-checkout-session.js` — verifies a payment after
  Stripe redirects the customer back.
- `netlify/functions/utils/pricing.js` — the real prices (keep in sync with
  `MENU_ITEMS` in `js/main.js` whenever you change a price).
- `order-success.html` — the "thanks, you're paid up" page. It only emails/logs
  the order to your Google Sheet **after** confirming the payment succeeded.
- `js/main.js` has a single switch: `ONLINE_PAYMENT_ENABLED` (currently
  `false`, so your live site keeps working exactly as it does now — pay in
  person — until you flip it).

## One-time setup

1. **Re-deploy the site** so Netlify picks up the new `netlify.toml` and
   `netlify/functions` folder — drag the whole `Berel's Bakery` folder onto
   your site's **Deploys** tab again (same as any other update).
2. In the **Stripe Dashboard**, make sure you're in **Sandbox/Test mode**
   (top-right toggle), then go to **Developers → API keys**.
3. Copy the **Secret key** (starts `sk_test_...`). Keep this private — never
   put it in the website's files or share it in chat.
4. In **Netlify**: **Site configuration → Environment variables → Add a
   variable**.
   - Key: `STRIPE_SECRET_KEY`
   - Value: paste your Stripe secret key
   - Scope: all deploy contexts is fine
5. **Trigger a redeploy** so the function picks up the new variable:
   **Deploys → Trigger deploy → Deploy site**.

## Turn it on

6. Open `js/main.js`, find:
   ```js
   const ONLINE_PAYMENT_ENABLED = false;
   ```
   change it to `true`, save, and re-deploy (drag the folder onto Netlify
   again, or trigger a deploy).

## Test it (still in sandbox — no real money moves)

7. On your live site, add items to the cart and click **Continue to Payment**.
8. On the Stripe checkout page, use a test card:
   - Card number: **4242 4242 4242 4242**
   - Expiry: any future date, e.g. 12/34
   - CVC: any 3 digits, e.g. 123
   - ZIP/postcode: any
9. Complete payment — you should land on `order-success.html` with your order
   summary, and shortly after:
   - A new row in your **Google Sheet** with **Payment: "Paid online (Stripe)"**
   - An email to **berels.bakery@gmail.com** with the same details
10. Check **Stripe Dashboard → Payments** — the test payment should appear there too.

## Going live (real payments)

11. In Stripe, switch to **Live mode** and grab the **live** secret key
    (`sk_live_...`).
12. In Netlify, edit the `STRIPE_SECRET_KEY` environment variable and replace
    the test key with the live one.
13. Redeploy. Real card payments now work — test with a small real order first
    if you'd like extra confidence.

## Notes
- **Changed a price?** Update it in **both** `js/main.js` (`MENU_ITEMS`) and
  `netlify/functions/utils/pricing.js` — the second one is what actually
  decides the charge, so if you forget it, Stripe will keep charging the old
  price even though the page displays the new one.
- **Fees:** Stripe takes roughly 1.7% + $0.30 AUD per successful payment —
  this is separate from Netlify, which stays free.
- **Turning it back off:** set `ONLINE_PAYMENT_ENABLED` back to `false` and
  redeploy — the site instantly reverts to pay-in-person, nothing else breaks.
- If checkout ever fails immediately with "Online payment isn't set up yet",
  it means `STRIPE_SECRET_KEY` isn't set (or a deploy hasn't happened since
  you added it) — check step 4–5.
- If it fails with something like "fetch is not defined" in the Netlify
  function logs (**Site → Logs → Functions**), add another environment
  variable `NODE_VERSION` = `18` (Site configuration → Environment variables)
  and redeploy — this makes sure Netlify runs the function on a Node version
  that has built-in `fetch`.
