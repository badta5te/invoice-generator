import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultInvoice, formatDate, formatMoney, nextInvoiceNumber, totals } from "../src/invoice";

test("totals sum line items and apply tax", () => {
  const invoice = {
    ...defaultInvoice(),
    items: [
      { description: "Dev", quantity: 43.5, rate: 40 },
      { description: "Review", quantity: 6, rate: 40 },
    ],
    taxPercent: 10,
  };
  assert.deepEqual(totals(invoice), { subtotal: 1980, tax: 198, total: 2178 });
});

test("nextInvoiceNumber keeps prefix and zero padding", () => {
  assert.equal(nextInvoiceNumber("0003"), "0004");
  assert.equal(nextInvoiceNumber("INV-0099"), "INV-0100");
  assert.equal(nextInvoiceNumber("2026-09"), "2026-10");
  assert.equal(nextInvoiceNumber("draft"), "draft");
});

test("formats money and dates like the sample", () => {
  assert.equal(formatMoney(1720, { currency: "USD", locale: "en-US" }), "$1,720.00");
  assert.equal(formatDate("2026-09-04", "en-US"), "Sep 4, 2026");
});
