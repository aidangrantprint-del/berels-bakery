# Order emails + Google Sheet — setup

This connects the website's order form to a Google Sheet and emails each order.
Do this **while logged into the Google account that will own the Sheet** (the one
you have the password to). Orders will be emailed to **berels.bakery@gmail.com**
and the Sheet will be **shared with** that same address.

## One-time setup (~10 minutes)

1. **Log in** to the account that will host the Sheet.
2. Go to **https://sheets.new** to create a new blank Google Sheet. Name it
   something like **"Berel's Bakery Orders"**.
3. **Share it with Asher:** click **Share** (top right) → type
   `berels.bakery@gmail.com` → set to **Editor** → **Send**.
4. In the Sheet, open **Extensions → Apps Script**.
5. Delete whatever code is in the editor, then paste the entire contents of
   **`Code.gs`** (in this folder). Click the **Save** (disk) icon.
6. Click **Deploy → New deployment**.
   - Click the gear ⚙ next to "Select type" → choose **Web app**.
   - **Execute as:** Me
   - **Who has access:** **Anyone**  ← required so the website can send to it
   - Click **Deploy**.
7. **Authorize** when prompted: pick the account → on the "Google hasn't verified
   this app" screen click **Advanced → Go to (project name) (unsafe) → Allow**.
   (This warning is normal because it's your own script.)
8. Copy the **Web app URL** it gives you (it ends in `/exec`).

## Final step

Send me that `/exec` URL and I'll paste it into the website
(`js/main.js` → `ORDER_ENDPOINT`). After that, every order will:
- add a row to your Google Sheet, **and**
- email a copy to berels.bakery@gmail.com.

(If you'd rather paste it yourself: open `js/main.js`, find the line
`const ORDER_ENDPOINT = "";` near the top, and put the URL between the quotes.)

## Notes
- **Changing the script later?** You must redeploy: **Deploy → Manage deployments
  → edit (pencil) → Version: New version → Deploy**. Otherwise changes won't take effect.
- **Email recipient(s):** edit `NOTIFY_EMAIL` in `Code.gs` (you can list several,
  separated by commas) then redeploy.
- **Adding/renaming a menu item?** Update the `PRODUCTS` list in `Code.gs` to match,
  then redeploy (paste code → New version → Deploy). The Sheet's columns update
  themselves automatically on the next order — any product missing a column gets
  one added next to the existing ones. You do **not** need to clear the sheet.
  Note: **renaming** a product (e.g. "Cinnamon Scroll w/ Cream Cheese Icing" →
  "Cinnamon Scroll") adds a *new* column rather than renaming the old one, so the
  old column is left behind, empty, going forward — feel free to delete it by hand
  in the Sheet if you'd like to tidy up.
- **Spam:** a public form can attract bots. If that happens, tell me and I'll add a
  hidden "honeypot" field to filter them out.
- The emailed/Sheet total is an **estimate** — there's no payment step, so you
  confirm price when you follow up with the customer.
