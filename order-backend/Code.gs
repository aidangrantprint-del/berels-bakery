/**
 * Berel's Bakery — order receiver (v3, 2026-11-25: adds "Warning" column for
 * orders that include a sold-out item; orders now also arrive from the Stripe
 * webhook, so every paid order is recorded even if the customer closes the tab)
 *
 * Saves each order as a row in the FIRST tab of this Google Sheet (one column
 * per product, showing the quantity ordered) and emails a copy.
 * Paste this whole file into Extensions → Apps Script, replacing everything.
 *
 * - "Email sent" column: shows when the alert email went out, or the exact
 *   error if it failed, so a missing email is never a mystery.
 * - "Stripe session" column: the payment id. If the same order arrives twice
 *   (e.g. the customer refreshes the success page) the repeat is ignored.
 * - Columns are self-healing: missing product/summary columns are added
 *   automatically on the next order.
 * - Run testEmail() from the editor to check emails without placing an order.
 */

// Where order alert emails are sent (comma-separate for more than one).
var NOTIFY_EMAIL = "berels.bakery@gmail.com";

// One column per product. These names must match the item names on the
// website (MENU_ITEMS in js/main.js) exactly — except Cinnamon Scroll, which
// is split into two columns by columnsFor() below.
var PRODUCTS = [
  "White Sourdough Loaf",
  "Seeded Sourdough Loaf",
  "Choc Chunk Cookie",
  "Cinnamon Scroll (no icing)",
  "Cinnamon Scroll (iced)",
];

var BASE_COLUMNS = ["Timestamp", "Name", "Contact method", "Contact"];
var SUMMARY_COLUMNS = ["Total items", "Order total", "Payment", "Notes", "Warning", "Email sent", "Stripe session"];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // one order at a time, so rows/headers never collide
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var headers = ensureHeaders(sheet);

    // Ignore repeats of an order we've already recorded.
    var sessionId = String(data.sessionId || "");
    if (sessionId && alreadyRecorded(sheet, headers, sessionId)) {
      return reply({ ok: true, duplicate: true });
    }

    // Tally quantities by product name.
    var items = data.items || [];
    var qtyByName = {};
    var totalQty = 0;
    items.forEach(function (i) {
      totalQty += Number(i.qty) || 0;
      columnsFor(i).forEach(function (c) {
        qtyByName[c.column] = (qtyByName[c.column] || 0) + c.qty;
      });
    });
    var totalText = "$" + Number(data.total || 0).toFixed(2);
    var paymentText = data.paidOnline ? "Paid online (Stripe)" : "Pay in person";

    // Send the email first so its result can be written into the row.
    var itemsText = items.map(function (i) {
      return "  • " + i.qty + " x " + i.name + (i.note ? " (+ " + i.note + ")" : "");
    }).join("\n");
    var warning = String(data.warning || "");
    var body =
      (warning ? "⚠ " + warning + "\n\n" : "") +
      "New order from the Berel's Bakery website\n\n" +
      "Name: " + (data.name || "") + "\n" +
      "Contact by " + (data.contactMethod || "") + ": " + (data.contact || "") + "\n\n" +
      "Items:\n" + itemsText + "\n\n" +
      "Total items: " + totalQty + "\n" +
      "Order total: " + totalText + "\n" +
      "Payment: " + paymentText + "\n" +
      "Notes: " + (data.notes || "(none)") + "\n";

    var emailStatus;
    try {
      var mail = {
        to: NOTIFY_EMAIL,
        subject: (warning ? "⚠ SOLD OUT ITEM — " : "") +
          (data.paidOnline ? "Paid order" : "New order") + " — " + (data.name || "customer") + " — " + totalText,
        body: body,
        name: "Berel's Bakery Website",
      };
      var contact = String(data.contact || "");
      if (data.contactMethod === "email" && contact.indexOf("@") > 0) {
        mail.replyTo = contact; // hitting Reply goes straight to the customer
      }
      MailApp.sendEmail(mail);
      emailStatus = "Sent";
    } catch (mailErr) {
      emailStatus = "FAILED: " + mailErr.message;
    }

    // Build the row in whatever column order the sheet currently has.
    var values = {
      "Timestamp": new Date(),
      "Name": data.name || "",
      "Contact method": data.contactMethod || "",
      "Contact": data.contact || "",
      "Total items": totalQty,
      "Order total": totalText,
      "Payment": paymentText,
      "Notes": data.notes || "",
      "Warning": warning,
      "Email sent": emailStatus,
      "Stripe session": sessionId,
    };
    Object.keys(qtyByName).forEach(function (name) {
      values[name] = qtyByName[name];
    });
    var row = headers.map(function (h) {
      return Object.prototype.hasOwnProperty.call(values, h) ? values[h] : "";
    });
    sheet.appendRow(row);

    return reply({ ok: true, email: emailStatus });
  } catch (err) {
    console.error(err);
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Which Sheet column(s) an order line goes in. Cinnamon Scrolls are split into
 * iced / no icing, using the note the website sends, e.g. "2 with cream cheese icing".
 */
function columnsFor(item) {
  var qty = Number(item.qty) || 0;
  if (item.name === "Cinnamon Scroll") {
    var match = /(\d+)\s+with/.exec(String(item.note || ""));
    var iced = match ? Math.min(Number(match[1]), qty) : 0;
    var out = [];
    if (qty - iced > 0) out.push({ column: "Cinnamon Scroll (no icing)", qty: qty - iced });
    if (iced > 0) out.push({ column: "Cinnamon Scroll (iced)", qty: iced });
    return out;
  }
  return [{ column: item.name, qty: qty }];
}

/** True if this Stripe session id is already in the "Stripe session" column. */
function alreadyRecorded(sheet, headers, sessionId) {
  var col = headers.indexOf("Stripe session");
  var lastRow = sheet.getLastRow();
  if (col === -1 || lastRow < 2) return false;
  var ids = sheet.getRange(2, col + 1, lastRow - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]) === sessionId) return true;
  }
  return false;
}

/**
 * Makes sure the header row has every column. Missing products are inserted
 * just before "Total items"; any other missing column is added at the end.
 * Returns the final header row as an array of strings.
 */
function ensureHeaders(sheet) {
  if (sheet.getLastColumn() === 0) {
    var fresh = BASE_COLUMNS.concat(PRODUCTS).concat(SUMMARY_COLUMNS);
    sheet.appendRow(fresh);
    return fresh;
  }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);

  PRODUCTS.forEach(function (name) {
    if (headers.indexOf(name) === -1) {
      var insertPos = headers.indexOf("Total items");
      if (insertPos === -1) insertPos = headers.length;
      sheet.insertColumnBefore(insertPos + 1); // 1-indexed
      sheet.getRange(1, insertPos + 1).setValue(name);
      headers.splice(insertPos, 0, name);
    }
  });

  BASE_COLUMNS.concat(SUMMARY_COLUMNS).forEach(function (name) {
    if (headers.indexOf(name) === -1) {
      sheet.getRange(1, headers.length + 1).setValue(name);
      headers.push(name);
    }
  });

  return headers;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this from the editor (choose "testEmail" in the function dropdown, then
 * click Run) to check that order emails arrive. Also shows in the Execution
 * log how many emails Google will still let this script send today.
 */
function testEmail() {
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: "Test — Berel's Bakery order emails are working",
    body: "If you can read this, order alert emails from the website will reach this inbox.",
    name: "Berel's Bakery Website",
  });
  console.log("Test email sent to " + NOTIFY_EMAIL +
    ". Emails left today: " + MailApp.getRemainingDailyQuota());
}
