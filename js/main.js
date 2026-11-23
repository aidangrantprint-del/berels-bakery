/* ===== Berel's Bakery — shared scripts ===== */

/* Single source of truth for menu items. Reused by the order form.
   `price`      — cost per unit (used when there is no packPrices table)
   `packs`      — the only quantities this item can be bought in
   `packPrices` — total price for each pack size (overrides `price` when present)
   `addOn`      — optional extra, charged per unit
   `packSelect` — show pack choices as a dropdown instead of a +/- stepper
   */
const MENU_ITEMS = [
  { id: "white-sourdough",    name: "White Sourdough Loaf",  price: 8.50,  max: 2 },
  { id: "seeded-sourdough",   name: "Seeded Sourdough Loaf", price: 11.00, max: 2 },
  {
    id: "choc-chunk-cookie",
    name: "Choc Chunk Cookie",
    price: 5.00,
    packs: [1, 4, 6, 12],
    packPrices: { 1: 5.00, 4: 15.00, 6: 25.00, 12: 45.00 },
    packSelect: true,
  },
  {
    id: "cinnamon-scroll",
    name: "Cinnamon Scroll",
    price: 4.50,
    packs: [1, 3, 6],
    packPrices: { 1: 4.50, 3: 12.50, 6: 23.00 },
    addOn: { label: "cream cheese icing", price: 1.50 },
    packSelect: true,
  },
];

/* Cart state: maps item id -> quantity */
const cart = {};

/* Cart state: maps item id -> true if that item's optional add-on is selected */
const cartAddons = {};

/* Paste your deployed Google Apps Script Web App URL between the quotes to
   enable emailing orders + saving them to your Google Sheet.
   Leave it as "" and the form still works (just shows the on-page confirmation). */
const ORDER_ENDPOINT = "https://script.google.com/macros/s/AKfycbzo_p_47rVAGjdnOUn2vjfydi2P71WgVQzSpl0TNM_Tc_hqMLBiaeM09_AD-gxTmkdN/exec";

/* Online payment is required to place an order — make sure STRIPE_SECRET_KEY
   is set in Netlify (Site configuration → Environment variables) and a deploy
   has run since, or checkout will fail with no fallback. */
const ONLINE_PAYMENT_ENABLED = true;
const STRIPE_CHECKOUT_ENDPOINT = "/.netlify/functions/create-checkout";

/* ---- Image placeholder fallback ----
   Images point at images/<id>.jpg. Until the real photo is added,
   this draws a labelled placeholder so the layout still looks right.
   Drop a real <id>.jpg into /images and it appears automatically. */
function placeholderImg(img) {
  if (img.dataset.fallbackApplied) return; // avoid loops
  img.dataset.fallbackApplied = "1";
  const label = (img.getAttribute("alt") || "Berel's Bakery").trim();
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">' +
    '<rect width="100%" height="100%" fill="#f3e3c9"/>' +
    '<text x="50%" y="46%" font-family="Georgia, serif" font-size="30" fill="#a06a26" ' +
    'text-anchor="middle">' + escapeXml(label) + '</text>' +
    '<text x="50%" y="58%" font-family="sans-serif" font-size="16" fill="#6b5240" ' +
    'text-anchor="middle">photo coming soon</text></svg>';
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, c => (
    { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]
  ));
}

document.addEventListener("DOMContentLoaded", () => {
  loadCart();        // restore saved cart (shared across all pages)
  injectCartUI();    // add the floating button + sidebar to every page

  // Attach placeholder fallback to any product image that fails to load.
  document.querySelectorAll("img[data-placeholder]").forEach(img => {
    img.addEventListener("error", () => placeholderImg(img));
    // If the image already failed before the listener attached, handle it now.
    if (img.complete && img.naturalWidth === 0) placeholderImg(img);
  });

  renderCart();
  renderItemControls();
  initOrderForm();
  initTransparentNav();
  initSlideshows();
  initCartControls();
  initMenuCart();
});

/* ---- Menu page: cross-fade each card's slideshow ---- */
function initSlideshows() {
  document.querySelectorAll(".slideshow").forEach(show => {
    const slides = show.querySelectorAll(".slide");
    if (slides.length < 2) return; // single image — nothing to cycle
    const interval = parseInt(show.dataset.interval, 10) || 8000;
    let i = 0;
    setInterval(() => {
      slides[i].classList.remove("active");
      i = (i + 1) % slides.length;
      slides[i].classList.add("active");
    }, interval);
  });
}

/* ---- Home page: make the nav transparent while scrolled to the very top ---- */
function initTransparentNav() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  const update = () => {
    header.classList.toggle("at-top", window.scrollY <= 20);
  };
  update();
  window.addEventListener("scroll", update, { passive: true });
}

/* ---- Cart persistence (shared across pages via localStorage) ---- */
const CART_KEY = "berels-cart";
const CART_ADDONS_KEY = "berels-cart-addons";

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
    Object.keys(cart).forEach(k => delete cart[k]);
    Object.entries(saved).forEach(([k, v]) => {
      if (Number(v) > 0 && MENU_ITEMS.some(m => m.id === k)) cart[k] = Number(v);
    });
  } catch (e) { /* ignore unreadable storage */ }

  try {
    const savedAddons = JSON.parse(localStorage.getItem(CART_ADDONS_KEY) || "{}");
    Object.keys(cartAddons).forEach(k => delete cartAddons[k]);
    Object.entries(savedAddons).forEach(([k, v]) => {
      if (Number(v) > 0 && MENU_ITEMS.some(m => m.id === k)) cartAddons[k] = Number(v);
    });
  } catch (e) { /* ignore unreadable storage */ }
}

function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* ignore */ }
  try { localStorage.setItem(CART_ADDONS_KEY, JSON.stringify(cartAddons)); } catch (e) { /* ignore */ }
}

/* ---- Per-item order control: "Order this" button <-> − qty + stepper
   (or, for pack-select items like the cinnamon scroll, a dropdown) ---- */
function renderItemControls() {
  document.querySelectorAll(".order-control[data-item-id]").forEach(ctrl => {
    const id = ctrl.dataset.itemId;
    const qty = cart[id] || 0;
    const packs = itemPacks(id);
    const addOn = itemAddOn(id);
    const item = MENU_ITEMS.find(m => m.id === id);

    const addOnHtml = (qty > 0 && addOn) ? `
      <select class="pack-select addon-select" data-addon-select="${id}" aria-label="How many with ${addOn.label}?">
        ${addOnOptionsHtml(addOn, qty, cartAddons[id] || 0)}
      </select>` : "";

    if (item && item.packSelect) {
      ctrl.innerHTML = `
        <select class="pack-select" data-pack-select="${id}" aria-label="Choose pack size for ${item.name}">
          ${packOptionsHtml(item, qty)}
        </select>${addOnHtml}`;
      return;
    }

    const packHint = packs
      ? `<p class="pack-hint">${item && item.packPrices
          ? packs.map(p => `${p} for $${Number(item.packPrices[p]).toFixed(2)}`).join(" · ")
          : `Sold in packs of ${packs.join(", ")}`}</p>`
      : "";

    if (qty === 0) {
      ctrl.innerHTML = `<button type="button" class="btn" data-order-add="${id}">Order this</button>${packHint}`;
    } else {
      const atMax = qty >= itemMax(id);
      ctrl.innerHTML = `
        <div class="order-stepper" role="group" aria-label="Quantity">
          <button type="button" class="qty-btn" data-cart-dec="${id}" aria-label="Remove one">−</button>
          <span class="qty-value">${qty}</span>
          <button type="button" class="qty-btn" data-cart-inc="${id}" aria-label="Add one"${atMax ? ' disabled title="Maximum reached"' : ''}>+</button>
        </div>${packHint}${addOnHtml}`;
    }
  });
}

/* ---- Inject the floating cart button + sidebar into every page ---- */
function injectCartUI() {
  if (document.getElementById("cart-sidebar")) return; // already present
  const html = `
  <button type="button" class="cart-fab" id="cart-fab" aria-label="Open your order">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="21" r="1"></circle>
      <circle cx="20" cy="21" r="1"></circle>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
    </svg>
    <span class="fab-badge hidden" id="cart-badge">0</span>
  </button>
  <div class="cart-overlay" id="cart-overlay"></div>
  <aside class="cart-sidebar" id="cart-sidebar" aria-label="Your order">
    <div class="cart-sidebar-head">
      <h2>Your Order</h2>
      <button type="button" class="cart-close" data-close-cart aria-label="Close">×</button>
    </div>
    <div class="cart-sidebar-body">
      <form id="order-form" novalidate>
        <div class="field">
          <span class="label">Your cart</span>
          <div class="cart-summary" id="cart-summary"></div>
          <p class="error" id="err-items">Please add at least one item to your cart.</p>
        </div>
        <div class="field">
          <label class="label" for="name">Your name</label>
          <input type="text" id="name" name="name">
          <p class="error" id="err-name">Please enter your name.</p>
        </div>
        <div class="field">
          <label class="label" for="notes">Special requests <span style="font-weight:400">(optional)</span></label>
          <textarea id="notes" name="notes"></textarea>
        </div>
        <div class="field">
          <span class="label">How should we contact you?</span>
          <div class="radio-row">
            <label><input type="radio" name="contactMethod" value="phone"> Phone</label>
            <label><input type="radio" name="contactMethod" value="email"> Email</label>
          </div>
          <p class="error" id="err-method">Please pick how you'd like to be contacted.</p>
        </div>
        <div class="field hidden" id="phone-field">
          <label class="label" for="phone">Phone number</label>
          <input type="tel" id="phone" name="phone">
          <p class="error" id="err-phone">Please enter your phone number.</p>
        </div>
        <div class="field hidden" id="email-field">
          <label class="label" for="email">Email address</label>
          <input type="email" id="email" name="email">
          <p class="error" id="err-email">Please enter your email address.</p>
        </div>
        <p class="pay-note">${ONLINE_PAYMENT_ENABLED
          ? "You'll be taken to a secure payment page to pay by card before your order is confirmed."
          : "Payment is made in person at pickup. A 1.6% surcharge may apply to card payments."}</p>
        <button type="submit" class="btn" id="order-submit-btn" style="width:100%">${ONLINE_PAYMENT_ENABLED ? "Continue to Payment" : "Submit Order"}</button>
      </form>
      <div class="confirmation hidden" id="confirmation">
        <h2>Thanks, <span id="conf-name"></span>! 🥖</h2>
        <p>We've received your order request and will reach out by <strong id="conf-method"></strong> to confirm.</p>
        <p><strong>Your order:</strong></p>
        <ul id="conf-items"></ul>
        <p class="conf-total"><strong>Estimated total: <span id="conf-total"></span></strong></p>
      </div>
    </div>
  </aside>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

/* ---- Cart helpers ---- */
function itemPacks(id) {
  const m = MENU_ITEMS.find(x => x.id === id);
  return m && m.packs ? m.packs : null;
}

function itemMax(id) {
  const packs = itemPacks(id);
  let max;
  if (packs) {
    max = packs[packs.length - 1];
  } else {
    const m = MENU_ITEMS.find(x => x.id === id);
    max = m && m.max ? m.max : Infinity;
  }
  return max;
}

function changeQty(id, delta) {
  const packs = itemPacks(id);
  const current = cart[id] || 0;
  let next;

  if (packs) {
    // Pack-restricted item: step to the next/previous allowed pack size only.
    if (delta > 0) {
      const bigger = packs.find(p => p > current);
      next = bigger === undefined ? current : bigger;
    } else {
      const smaller = packs.filter(p => p < current);
      next = smaller.length ? smaller[smaller.length - 1] : 0;
    }
  } else {
    next = Math.min(itemMax(id), Math.max(0, current + delta));
  }

  if (next === 0) {
    delete cart[id];
    delete cartAddons[id]; // reset any selected add-on when the item is removed
  } else {
    cart[id] = next;
    clampAddOnCount(id); // the icing count can never exceed the new quantity
  }

  saveCart();
  renderCart();         // sidebar summary + badge
  renderItemControls(); // per-item "Order this" / steppers
}

/* Jump straight to a chosen pack size (used by the cinnamon scroll's
   dropdown, instead of stepping one pack at a time). */
function setPackQty(id, qty) {
  qty = Number(qty) || 0;
  if (qty === 0) {
    delete cart[id];
    delete cartAddons[id];
  } else {
    cart[id] = qty;
    clampAddOnCount(id);
  }
  saveCart();
  renderCart();
  renderItemControls();
}

function clampAddOnCount(id) {
  if (!cartAddons[id]) return;
  const qty = cart[id] || 0;
  if (cartAddons[id] > qty) {
    if (qty === 0) delete cartAddons[id];
    else cartAddons[id] = qty;
  }
}

/* Builds <option> tags for a pack-select dropdown, one per allowed pack size. */
function packOptionsHtml(item, selectedQty) {
  const opts = [`<option value="0">Choose amount</option>`];
  item.packs.forEach(p => {
    const price = item.packPrices && item.packPrices[p] !== undefined ? item.packPrices[p] : item.price * p;
    const label = (p === 1 ? "1" : "Pack of " + p) + " — $" + Number(price).toFixed(2);
    opts.push(`<option value="${p}"${Number(selectedQty) === p ? " selected" : ""}>${label}</option>`);
  });
  return opts.join("");
}

function itemAddOn(id) {
  const m = MENU_ITEMS.find(x => x.id === id);
  return m && m.addOn ? m.addOn : null;
}

/* How many of the units in the cart should get the optional add-on
   (e.g. "2 of the 6 scrolls with icing"). Clamped to the current quantity. */
function setAddOnCount(id, count) {
  if (!itemAddOn(id)) return;
  const qty = cart[id] || 0;
  const clamped = Math.min(Math.max(Number(count) || 0, 0), qty);
  if (clamped === 0) delete cartAddons[id];
  else cartAddons[id] = clamped;
  saveCart();
  renderCart();
  renderItemControls();
}

/* Builds <option> tags for "how many get the add-on" (0..qty). */
function addOnOptionsHtml(addOn, qty, selectedCount) {
  const opts = [];
  for (let i = 0; i <= qty; i++) {
    const label = i === 0 ? "No " + addOn.label : i + " with " + addOn.label + " (+$" + (i * addOn.price).toFixed(2) + ")";
    opts.push(`<option value="${i}"${selectedCount === i ? " selected" : ""}>${label}</option>`);
  }
  return opts.join("");
}

/* Base price for a given quantity: uses the pack price table when the item has
   one (e.g. a 3-pack costs a set price), otherwise unit price × quantity. */
function basePriceFor(item, qty) {
  if (item.packPrices && item.packPrices[qty] !== undefined) return item.packPrices[qty];
  return item.price * qty;
}

function cartLines() {
  return MENU_ITEMS
    .filter(i => cart[i.id])
    .map(i => {
      const qty = cart[i.id];
      const addOn = itemAddOn(i.id);
      const addOnCount = addOn ? Math.min(cartAddons[i.id] || 0, qty) : 0;
      // Add-on is charged per unit that has it, on top of the (possibly discounted) pack price.
      const lineTotal = basePriceFor(i, qty) + addOnCount * (addOn ? addOn.price : 0);
      return {
        id: i.id,
        name: i.name,
        qty: qty,
        price: lineTotal / qty, // effective per-unit price, for the emailed record
        lineTotal: lineTotal,
        note: addOnCount > 0 ? addOnCount + " with " + addOn.label : null,
      };
    });
}

function cartTotal() {
  return cartLines().reduce((sum, l) => sum + l.lineTotal, 0);
}

function renderCart() {
  updateCartBadge();
  const summary = document.getElementById("cart-summary");
  if (!summary) return;
  const lines = cartLines();
  if (lines.length === 0) {
    summary.innerHTML = `<p class="cart-empty">Your cart is empty — add some items.</p>`;
    return;
  }
  summary.innerHTML = `
    <ul class="cart-lines">
      ${lines.map(l => {
        const item = MENU_ITEMS.find(m => m.id === l.id);
        const noteHtml = l.note ? `<span class="cl-note">+ ${l.note}</span>` : "";
        const controlsHtml = (item && item.packSelect)
          ? `<select class="pack-select pack-select-sm" data-pack-select="${l.id}" aria-label="Change quantity for ${l.name}">${packOptionsHtml(item, l.qty)}</select>`
          : (() => {
              const atMax = l.qty >= itemMax(l.id);
              return `
                <button type="button" class="qty-btn" data-cart-dec="${l.id}" aria-label="Remove one ${l.name}">−</button>
                <span class="qty-value">${l.qty}</span>
                <button type="button" class="qty-btn" data-cart-inc="${l.id}" aria-label="Add one ${l.name}"${atMax ? ' disabled title="Maximum reached"' : ''}>+</button>`;
            })();
        const addOn = item ? itemAddOn(item.id) : null;
        const addOnRow = addOn ? `
          <div class="cl-addon-row">
            <select class="pack-select pack-select-sm addon-select" data-addon-select="${l.id}" aria-label="How many with ${addOn.label}?">
              ${addOnOptionsHtml(addOn, l.qty, cartAddons[l.id] || 0)}
            </select>
          </div>` : "";
        return `<li>
          <span class="cl-name">${l.name}${noteHtml}</span>
          <span class="cl-controls">${controlsHtml}</span>
          <span class="cl-total">$${l.lineTotal.toFixed(2)}</span>
          ${addOnRow}
        </li>`;
      }).join("")}
    </ul>
    <div class="cart-total"><span>Total</span><span>$${cartTotal().toFixed(2)}</span></div>`;
}

/* Update the floating cart button's count badge (menu page only). */
function updateCartBadge() {
  const badge = document.getElementById("cart-badge");
  if (!badge) return;
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  badge.textContent = count;
  badge.classList.toggle("hidden", count === 0);
}

/* Menu page: floating cart button, slide-out sidebar, and "Order this" buttons. */
function initMenuCart() {
  const sidebar = document.getElementById("cart-sidebar");
  if (!sidebar) return; // only present on the menu page
  const overlay = document.getElementById("cart-overlay");
  const fab = document.getElementById("cart-fab");

  const openCart = () => { sidebar.classList.add("open"); overlay.classList.add("open"); };
  const closeCart = () => { sidebar.classList.remove("open"); overlay.classList.remove("open"); };

  if (fab) fab.addEventListener("click", () => sidebar.classList.contains("open") ? closeCart() : openCart());
  if (overlay) overlay.addEventListener("click", closeCart);
  document.querySelectorAll("[data-close-cart]").forEach(b => b.addEventListener("click", closeCart));
  document.querySelectorAll("[data-open-cart]").forEach(b =>
    b.addEventListener("click", e => { e.preventDefault(); openCart(); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeCart(); });

  // Open automatically when arriving from an "Order" link (menu.html#order)
  if (location.hash === "#order") openCart();

  updateCartBadge();
}

/* Delegated +/- controls inside the cart summary. */
function initCartControls() {
  document.addEventListener("click", e => {
    const inc = e.target.closest("[data-cart-inc]");
    const dec = e.target.closest("[data-cart-dec]");
    const add = e.target.closest("[data-order-add]");
    if (inc) changeQty(inc.dataset.cartInc, 1);
    if (dec) changeQty(dec.dataset.cartDec, -1);
    if (add) changeQty(add.dataset.orderAdd, 1);
  });

  document.addEventListener("change", e => {
    const addonSelect = e.target.closest("[data-addon-select]");
    if (addonSelect) setAddOnCount(addonSelect.dataset.addonSelect, addonSelect.value);

    const packSelect = e.target.closest("[data-pack-select]");
    if (packSelect) setPackQty(packSelect.dataset.packSelect, packSelect.value);
  });
}

/* ---- Order page: validation, conditional contact field, confirmation ---- */
function initOrderForm() {
  const form = document.getElementById("order-form");
  if (!form) return;

  const phoneRadio = form.querySelector('input[name="contactMethod"][value="phone"]');
  const emailRadio = form.querySelector('input[name="contactMethod"][value="email"]');
  const phoneField = document.getElementById("phone-field");
  const emailField = document.getElementById("email-field");
  const phoneInput = form.querySelector('input[name="phone"]');
  const emailInput = form.querySelector('input[name="email"]');

  function syncContactFields() {
    const usePhone = phoneRadio.checked;
    const useEmail = emailRadio.checked;
    phoneField.classList.toggle("hidden", !usePhone);
    emailField.classList.toggle("hidden", !useEmail);
    phoneInput.required = usePhone;
    emailInput.required = useEmail;
  }
  phoneRadio.addEventListener("change", syncContactFields);
  emailRadio.addEventListener("change", syncContactFields);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    let ok = true;

    const name = form.querySelector('input[name="name"]');
    ok = setError("err-name", !name.value.trim()) && ok;

    const lines = cartLines();
    ok = setError("err-items", lines.length === 0) && ok;

    const method = form.querySelector('input[name="contactMethod"]:checked');
    ok = setError("err-method", !method) && ok;

    if (method && method.value === "phone") {
      ok = setError("err-phone", !phoneInput.value.trim()) && ok;
    }
    if (method && method.value === "email") {
      ok = setError("err-email", !emailInput.value.trim()) && ok;
    }

    if (!ok) return;

    // Success.
    const methodLabel = method.value === "phone" ? "phone" : "email";
    const contactValue = method.value === "phone" ? phoneInput.value.trim() : emailInput.value.trim();
    const notes = (form.querySelector('[name="notes"]')?.value || "").trim();

    if (ONLINE_PAYMENT_ENABLED) {
      // Redirect to Stripe to pay — the order is only emailed/saved to the
      // Sheet afterwards, once payment is confirmed (see order-success.html).
      const submitBtn = document.getElementById("order-submit-btn");
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Redirecting to payment…"; }

      try {
        const res = await fetch(STRIPE_CHECKOUT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.value.trim(),
            contactMethod: methodLabel,
            contact: contactValue,
            notes: notes,
            cart: { ...cart },
            addons: { ...cartAddons },
          }),
        });
        const data = await res.json();
        if (res.ok && data.url) {
          window.location.href = data.url;
          return;
        }
        throw new Error(data.error || "No checkout URL returned.");
      } catch (err) {
        console.error("Stripe checkout failed:", err);
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Continue to Payment"; }
        alert("Sorry, we couldn't start checkout. Please try again in a moment.");
      }
      return;
    }

    // Send to Google Sheet + email (only if an endpoint is configured).
    sendOrder({
      timestamp: new Date().toISOString(),
      name: name.value.trim(),
      contactMethod: methodLabel,
      contact: contactValue,
      notes: notes,
      items: lines.map(l => ({ name: l.name, qty: l.qty, price: l.price, lineTotal: l.lineTotal, note: l.note })),
      total: cartTotal(),
    });

    // Show confirmation, hide form.
    document.getElementById("conf-name").textContent = name.value.trim();
    document.getElementById("conf-method").textContent = methodLabel + " (" + contactValue + ")";
    document.getElementById("conf-items").innerHTML =
      lines.map(l => `<li>${l.qty} × ${l.name}${l.note ? " (+ " + l.note + ")" : ""} — $${l.lineTotal.toFixed(2)}</li>`).join("");
    document.getElementById("conf-total").textContent = "$" + cartTotal().toFixed(2);

    form.classList.add("hidden");
    const conf = document.getElementById("confirmation");
    conf.classList.remove("hidden");
    conf.scrollIntoView({ behavior: "smooth", block: "center" });

    // Empty the cart (order is placed) and reset everything.
    Object.keys(cart).forEach(k => delete cart[k]);
    Object.keys(cartAddons).forEach(k => delete cartAddons[k]);
    saveCart();
    updateCartBadge();
    renderItemControls();
  });

  // helper: show/hide an error element; returns true when valid (no error)
  function setError(id, isInvalid) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("show", isInvalid);
    return !isInvalid;
  }
}

/* ---- Send the order to the Google Apps Script Web App (Sheet + email) ---- */
function sendOrder(payload) {
  if (!ORDER_ENDPOINT) return; // not set up yet — skip silently
  fetch(ORDER_ENDPOINT, {
    method: "POST",
    mode: "no-cors", // Apps Script web apps don't send CORS headers; we don't need to read the reply
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  }).catch(err => console.error("Order send failed:", err));
}
