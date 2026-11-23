# Berel's Bakery — Website

A small static website built with plain HTML, CSS, and JavaScript. No build step,
no server, no dependencies — just open the files in a browser.

## Pages
- `index.html` — Home, with "About me" and "About my business".
- `menu.html` — The menu. **Tap any product photo** to open its detail page.
- `items/*.html` — One detail page per item (ingredients + description). These are
  reachable only from the menu photos, not from the top navigation.
- `order.html` — Order form: name, item selection, phone/email contact preference.
  On submit it shows an on-page confirmation (it does not send anything anywhere).

## How to view it
Double-click `index.html`, or from this folder run:

    open index.html         (Mac)
    start index.html        (Windows)

## Adding real photos
Drop your JPGs into the `images/` folder using the names listed in
`images/README.txt`. They'll appear automatically. Until then, labelled
placeholders are shown.

## Editing content
- Text (about sections, descriptions, ingredients, prices) is plain HTML — edit
  the relevant `.html` file directly.
- Colours live as CSS variables at the top of `css/style.css`.
- The list of items used by the order form is the `MENU_ITEMS` array at the top of
  `js/main.js`. If you add/rename a menu item, update that array, add a card in
  `menu.html`, and add a matching page in `items/`.
