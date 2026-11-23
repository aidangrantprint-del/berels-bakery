# CLAUDE.md — Berel's Bakery

Handoff notes so work can continue seamlessly in Claude Code CLI. Everything here
was verified against the files in this folder on 2026-11-07. If code and this file
disagree, trust the code and fix this file.

> No secrets live in this file or in the repo. Keys/tokens are Netlify environment
> variables (names listed below). Never paste real values into chat or commit them.

---

## 1. What this is

The live website for **Berel's Bakery** — a small Melbourne (Caulfield South,
Australia) sourdough and sweets bakery run by **Asher Grosberg (AKA "Berel")**.
Live at **https://berelsbakery.com** on Netlify's free plan.

Customers browse a menu, build a cart in a slide-out sidebar, and **must pay online
via Stripe Checkout** (currently **sandbox/test mode**). Orders are then emailed and
logged to a Google Sheet. There are **no stock limits** — an Airtable inventory system
was built, then removed at the owner's request on 2026-11-06.

Public business details used on the site (already public, safe to reuse):
phone `0456643409`, email `berels.bakery@gmail.com`, est. 2026, currency **AUD**,
Australian spelling (flavour, colour, caramelised).

### Current status (honest summary)
| Area | Status |
|---|---|
| Static site (home, menu, 4 item pages, success page) | Done, live |
| Stripe Checkout (sandbox) | **Works end to end** — tested on the live site with a test card; correct amount, redirect, success page |
| Server-side price recalculation | Done |
| Order → Google Sheet + email | **Script v2 live (2026-11-24)** — direct POST test returns `{"ok":true,"email":"Sent"}`, duplicates skipped. Full browser purchase test still to confirm. See §6 item 1 |
| Inventory removal (2026-11-06) | Done in the files; **live site needs a redeploy** to pick it up (unconfirmed) |
| Going live with real payments | Not done (still sandbox) |

---

## 2. Tech setup & file map

**Plain HTML + one CSS file + one JS file. No framework, no bundler, no build step,
no `package.json`.** Hosted by Netlify; deployed by **drag-and-drop** of this folder
onto the site's **Deploys** tab (not Git-linked, so there is no "Trigger deploy"
button — re-drag the folder to redeploy). Netlify Functions are plain Node
CommonJS using built-in `fetch` (no npm packages, because drag-and-drop deploys
don't run `npm install`). Stripe is called via raw REST.

```
index.html              Home: transparent-nav hero + About Me + About My Business
menu.html               Menu grid (4 cards). Cart sidebar is injected by JS
order-success.html      Post-payment page; verifies payment, then logs the order
items/                  One detail page per product (NOT in the nav; reached by clicking the photo)
  white-sourdough.html  seeded-sourdough.html  choc-chunk-cookie.html  cinnamon-scroll.html
css/style.css           ALL styling (CSS variables at the top)
js/main.js              ALL client logic: MENU_ITEMS, cart, sidebar, dropdowns, checkout
images/                 hero.jpg, logo.png, favicon.png, + 4 product photos (cookie + scroll replaced 2026-11-24)
netlify.toml            publish "." + functions dir "netlify/functions"
netlify/functions/
  create-checkout.js    Recomputes price, creates the Stripe Checkout Session
  get-checkout-session.js  Verifies a session is paid; returns order details from metadata
  utils/pricing.js      SERVER-SIDE price list + computeOrder() — the real source of truth for charges
netlify/STRIPE_SETUP.md     Stripe setup + go-live steps
order-backend/Code.gs   Google Apps Script (paste into the Sheet's Apps Script editor)
order-backend/SETUP.md  Apps Script / Sheet setup steps
```

**Shell gotcha:** the folder path contains an apostrophe — `Berel's Bakery`. Quote
paths carefully. Environment is **macOS** (zsh) since 2026-11-07 — the owner moved
from Windows. Folder: `~/Library/CloudStorage/OneDrive-Personal/Claude Projects/Berel's Bakery`.
No Node or Python installed yet (running `python3` triggers Apple's developer-tools install prompt).

### Environment variables (Netlify → Site configuration → Environment variables)
Fill only the **Production** box; leave Deploy Previews/Branch/Local empty (the site
isn't Git-linked). Mark secrets with "Contains secret value".
| Name | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe key (currently the **sandbox** `sk_test_…`). Set |
A redeploy is required after adding/changing any of them.

---

## 3. How the system fits together

**Order flow**
1. Customer builds a cart. State is `cart` (item id → qty) and `cartAddons`
   (item id → number of units with the add-on), persisted to `localStorage`
   (`berels-cart`, `berels-cart-addons`) so it follows them across pages. The
   floating cart button + sidebar are injected into every page by `injectCartUI()`.
2. **Continue to Payment** → `POST /.netlify/functions/create-checkout` with **ids and
   quantities only, never prices**.
3. `create-checkout.js` recomputes the total from `utils/pricing.js`, rejects invalid
   pack sizes, then creates a Stripe Checkout Session (AUD, one line item per cart line; metadata holds name, contact,
   notes, `items_json`, `total`).
4. Stripe redirects to `order-success.html?session_id=…`. That page clears the cart,
   calls `get-checkout-session`, shows the receipt, then calls `sendOrder()` which
   POSTs to the Apps Script (Sheet row + email, `paidOnline: true`).

`ONLINE_PAYMENT_ENABLED` in `js/main.js` is `true`. Setting it `false` reverts to the
old pay-in-person flow (button "Submit Order", straight to Sheet/email, on-page
confirmation). That branch is kept but unused.

**Pricing lives in TWO places and must stay identical:** `MENU_ITEMS` in `js/main.js`
(display/cart) and `netlify/functions/utils/pricing.js` (the real charge). Also keep
`PRODUCTS` in `order-backend/Code.gs` matching the item *names* exactly (exception:
Cinnamon Scroll is split by `columnsFor()` into "Cinnamon Scroll (no icing)" / "(iced)"
columns, parsed from the line's `note` "N with cream cheese icing" — if the add-on label
or note format changes, update `columnsFor()`). Changing a
price, pack size or item name means updating all of them.

### Products
| Item | Price | Rules |
|---|---|---|
| White Sourdough Loaf | $8.50 | +/- stepper, max 2 per order |
| Seeded Sourdough Loaf | $11.00 | +/- stepper, max 2 per order |
| Choc Chunk Cookie | $5.00 each | Dropdown, packs 1/4/6/12 = $5 / $15 / $25 / $45 (changed 2026-11-24) |
| Cinnamon Scroll | $4.50 | Dropdown, packs 1/3/6 = $4.50 / $12.50 / $23; **cream cheese icing +$1.50 per scroll**, chosen with a second dropdown (0…qty), so "2 of 6 iced" is allowed |

Cart/dropdown behaviour is driven by flags on each `MENU_ITEMS` entry: `packs`,
`packPrices`, `packSelect` (dropdown instead of stepper), `addOn`, `max`.

---

## 4. Design decisions & the owner's preferences

**Visual system** (`css/style.css`): warm bakery palette via CSS variables —
`--cream #fdf6ec`, `--crust #c8893f`, `--crust-dark #a06a26`, `--dough #f3e3c9`,
`--cocoa #4a3526`, `--cocoa-soft #6b5240`; radius 14px; Georgia serif headings, system
sans body; pill-shaped crust-coloured buttons; dark-cocoa sticky header and footer.

**Layout / behaviour decisions the owner made**
- **No separate order page.** Ordering happens in the slide-out cart sidebar on the menu
  page. The nav "Order" link goes to `menu.html#order`, which auto-opens the sidebar.
  A circular floating cart button (with count badge) opens it from any page.
- **Home hero:** the banner photo `images/hero.jpg` (the logo-on-the-right version) shown
  whole (`contain`, 16:9). **No title or tagline text on it.** The only button is
  "See the Menu", enlarged and placed in the gap between the bread and the logo
  (`left:37%`). The home page nav is **transparent over the hero at the very top** and
  turns solid on scroll (`body.home .site-header.at-top`, toggled by JS at `scrollY ≤ 20`).
- **Footer:** blurb + "Contact Information" (phone, email) + a line telling people to order
  through the Menu/cart. **No Hours section** (removed on request).
- **Item detail pages** are not in the nav; reached only by clicking a product photo.
  They show description, price, **ingredients as a paragraph (not a list)**, allergens
  **in bold** both inside the ingredients and in the "Contains / May contain" lines, and
  the same order control as the menu. Cinnamon Scroll has a separate "Frosting ingredients" line.
- **Menu cards** use a short, catchy one-liner; the full text lives on the detail page.
  One fixed photo per card — a slideshow was tried and **reverted**. (`.slideshow`
  wrappers and `initSlideshows()` remain but do nothing with a single image.)
- **Logo:** was put in the header bar, then **removed**; it's now the **favicon**
  (`images/favicon.png`, tightly cropped to the badge).
- **Cart payment note** says the customer will be taken to a secure Stripe payment page.

**Content rules**
- The owner supplies the real copy (about text, descriptions, ingredients, allergens).
  Use it **verbatim**; fix obvious typos (e.g. "Weat" → "Wheat") and tell them.
- Allergen lists are exactly as the owner gave them — don't "improve" them; this is
  food-safety information.

**How the owner likes to work**
- Non-developer. Wants **numbered, click-by-click instructions** for anything done in
  Netlify, Stripe, Google (say which menu/button, what they'll see).
- Frequently says "open it in my browser" — after a visible change, open the page with
  `open "$HOME/Library/CloudStorage/OneDrive-Personal/Claude Projects/Berel's Bakery/<page>.html"`
  and remind them to hard-refresh (**Cmd+Shift+R**).
- Gives short, direct instructions and expects the change made. But when they ask a
  *can-I / is-there-a-way / how-do-I* question (or say "don't change the file yet"),
  **answer and let them choose first**, then edit.
- Prefers recommendations over option dumps. Likes to know what's free vs paid.
- Secrets: **tell them not to paste tokens/keys/webhook secrets into chat**.

---

## 5. Completed work (high level)
- Built the site: home (About Me + About My Business with the "why Berel's Bakery" Q&A),
  menu, four item pages, responsive CSS, placeholder-image fallback for missing photos.
- Real product photos from the owner's `Berel's Bakery Photos` folder (in Downloads),
  resized to 1200×1600 JPEG (~300–380 KB, EXIF rotation applied); originals left untouched.
- Removed Focaccia (menu, order list, page), restored and reworked Cinnamon Scroll
  (packs, icing add-on, new ingredients).
- Cart system → sidebar on menu page → global cart on every page; max/pack rules;
  dropdowns for cookies and scrolls; per-scroll icing selector.
- Stripe Checkout with server-side pricing; success page with verification.
- Apps Script: one column per product, self-healing headers (adds missing product
  columns automatically), "Payment" column, email with item list.
- Favicon; Netlify config; Stripe/Apps Script setup docs.
- Inventory system (Airtable) was built, then removed on request (2026-11-06).
- Hosting on Netlify with the custom domain `berelsbakery.com`.

---

## 6. Outstanding tasks (priority order)

0. **Finish the inventory removal (owner's side):** redeploy the folder; optionally delete
   the `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `STRIPE_WEBHOOK_SECRET` env vars in Netlify;
   delete the sandbox Stripe webhook pointing at `/.netlify/functions/stripe-webhook` if
   one was created (it now 404s). The Airtable base is unused.
1. **Orders → Sheet/email — mostly fixed 2026-11-24.** Earlier failures were most likely
   the bad `STRIPE_SECRET_KEY` (fixed). The Sheet row worked but the email couldn't be
   found, so `Code.gs` was rewritten (v2) and redeployed to the SAME `/exec` URL: writes to
   the first tab, adds an **"Email sent"** column (Sent / FAILED: reason), a **"Stripe
   session"** column used to skip duplicates (`order-success.html` now sends `sessionId`),
   LockService, JSON replies, `replyTo` = customer email, and a `testEmail()` function.
   Verified by curl: `{"ok":true,"email":"Sent"}`, and a resend → `{"duplicate":true}`.
   **Still to confirm:** the owner sees the email in the inbox, the Netlify folder is
   redeployed (success-page change), and one real browser test purchase logs a row.
   `sendOrder` still uses `mode:"no-cors"`, so browser-side failures stay invisible.
   Redeploying the script: **Deploy → Manage deployments → pencil → New version → Deploy**
   (never "New deployment" — that changes the URL). **Proposed (not yet agreed or built):** move
   order logging into a new Stripe webhook function (`stripe-webhook.js`) so it's
   server-to-server, runs even if the customer closes the tab, and failures show in Netlify function logs. If done, remove
   the `sendOrder` call from `order-success.html` to avoid duplicate rows/emails.
2. **Go live with real payments** (only after 1): switch Stripe to Live mode, put the
   live `sk_live_…` key in `STRIPE_SECRET_KEY`, redeploy, make one small real purchase and refund it. Checklist in
   `netlify/STRIPE_SETUP.md`.
3. **Netlify's "Powered by Netlify" badge overlaps the floating cart button** (both
   bottom-right) and briefly blocked clicks in testing. Offered to move the cart button
   to the bottom-left; the owner hasn't answered.
4. ~~No photo for Cinnamon Scroll~~ — **done 2026-11-24** (owner-supplied photo; old cookie photo
   backed up to `../Berel's Bakery photo backups/`, outside the deploy folder).
5. **Stale docs to fix:** `README.md` still describes the deleted `order.html`;
   `images/README.txt` still lists `sourdough-focaccia.jpg`.
6. Optional polish: `images/hero.jpg` is ~2.2 MB (could be optimized). Mobile layout fixed 2026-11-24
   (phone CSS in the `max-width: 600px` block: one-line header, solid non-overlay header on home,
   smaller hero button at `left:31%`, 16px form controls). Previously the mobile/phone layout
   was only lightly checked (cart sidebar, hero button placement at narrow widths);
   there are no automated tests in the repo.

### Known limitations (accepted)
- Stripe metadata values are capped at 500 chars; `items_json` is truncated at 490, so an
  unusually large cart could produce unparseable JSON (success page would show no items).
- A customer who pays but never reaches `order-success.html` is not logged (this is the
  reason for the webhook-logging proposal in task 1).
- Netlify rewrites internal links to drop `.html` on the live site — harmless.

---

## 7. Common workflows

**Preview:** open the HTML directly (`open <file>`) — fine for layout. Cart/dropdown/
Stripe behaviour needs scripts + Netlify Functions, so verify those on the live
site. (The Claude desktop app's built-in browser pane does not run scripts on local
`file://` pages; use the live `https://berelsbakery.com` or Node stand-ins.)

**Syntax check after editing JS:** `node --check js/main.js` and each file under
`netlify/functions/`. Node is **not installed on the Mac yet** (install from nodejs.org
or `brew install node`); it is used only for checks/tests, never for the site build.

**Deploy:** drag the whole `Berel's Bakery` folder onto Netlify → site → **Deploys**.
Env-var changes need a fresh deploy too. Apps Script changes are separate (see task 1).

**Change a price / pack / item:** update `js/main.js`, `netlify/functions/utils/pricing.js`,
the menu card and item page text, and `PRODUCTS` in `Code.gs` (then redeploy the script).

**Add a product:** new `MENU_ITEMS` entry (both files), a card in `menu.html`, a page in
`items/`, and an entry in `Code.gs` `PRODUCTS`.

**Resize a photo:** longest side 1600 px, JPEG quality ~82, apply EXIF orientation (on the Mac
use the built-in `sips`: `sips -Z 1600 -s format jpeg -s formatOptions 82 in.jpg --out out.jpg`;
check rotation afterwards — `sips` may not apply EXIF orientation). Keep originals elsewhere.

---

## 8. Skills, tools and project memory

Skills are not required by this project and **none were invoked while building it**.
Which skills exist depends on the session; the desktop session listed these as
available. In the CLI invoke one with `/skill-name`.
- **Design / front-end:** `frontend-design:frontend-design`, `impeccable:impeccable`,
  `high-end-visual-design`, `minimalist-ui`, `redesign-existing-projects`,
  `industrial-brutalist-ui`, `nateherk-design:scroll-craft`, `gpt-taste`,
  `image-to-code`, `imagegen-frontend-web` / `-mobile`, `motion` (animation).
  Use **only if the owner asks** for a visual refresh — the current design is a
  deliberately simple, hand-tuned palette that the owner has iterated on.
- **Browser / computer:** `anthropic-skills:built-in-browser`, `chrome-browser`,
  `computer-use` — for driving a real browser (this is how the live Stripe test was run).
  A Playwright MCP plugin may also be available.
- **Docs/files:** `anthropic-skills:docx`, `pdf`, `xlsx`, `pptx`, `google-workspace` —
  only if the owner wants a document, e.g. an orders export.
- **Claude Code housekeeping:** `init`, `review`, `security-review`, `code-review`,
  `simplify`, `verify`, `update-config`, `fewer-permission-prompts`, `loop`, `schedule`.
  `security-review` is worth running on `netlify/functions/` before going live (payment code,
  plus any webhook code if task 1's proposal is built).
- `.claude/settings.local.json` only allows a WebFetch for an unrelated site
  (carolscountrykitchen.com.au) — a separate project, see below.

**Project memory** (auto-memory for this folder) records that this folder was once
treated as read-only but, since 2026-09-19, **the owner builds the live site here — edit
when asked.** A separate "Carol's Country Kitchen remake" lives in a different Downloads
folder; don't mix the two projects up. If it's unclear which one a request is about, ask.
