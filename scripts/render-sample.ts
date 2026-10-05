// Renders an invoice to a PDF without a browser.
//   npm run sample                       -> sample.pdf with demo data
//   npm run sample -- invoice.json out.pdf -> any invoice JSON (same shape the app exports)
import { readFile, writeFile } from "node:fs/promises";
import { FontBytes, fontFiles, renderInvoicePdf } from "../src/pdf";
import { defaultInvoice, Invoice } from "../src/invoice";

const demo: Invoice = {
  ...defaultInvoice(new Date(2026, 8, 4)),
  sender: {
    name: "IE Ivan Petrov",
    details: "ivan@example.com\n1 Rustaveli Ave, Tbilisi, Georgia",
  },
  client: {
    name: "Acme Software Inc.",
    details: "EIN: 12-3456789\n100 Main Street, Suite 200,\nPhoenix AZ 85016, USA",
  },
  number: "0003",
  date: "2026-09-04",
  dueDate: "2026-09-30",
  items: [{ description: "Software development services, August 2026", quantity: 43, rate: 40 }],
};

const fonts = {} as FontBytes;
for (const [key, file] of Object.entries(fontFiles)) {
  fonts[key as keyof FontBytes] = await readFile(new URL(`../public/fonts/${file}`, import.meta.url));
}

const [input, output] = process.argv.slice(2);
const invoice: Invoice = input ? { ...demo, ...JSON.parse(await readFile(input, "utf8")) } : demo;
const out = output ?? "sample.pdf";
await writeFile(out, await renderInvoicePdf(invoice, fonts));
console.log(`wrote ${out}`);
