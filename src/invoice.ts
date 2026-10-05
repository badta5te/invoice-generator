export interface LineItem {
  description: string;
  quantity: number;
  rate: number;
}

export interface Labels {
  title: string;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  billTo: string;
  item: string;
  quantity: string;
  rate: string;
  amount: string;
  subtotal: string;
  tax: string;
  total: string;
  notes: string;
}

export interface Invoice {
  sender: {
    name: string;
    // Free-form lines under the name: email, address, tax id...
    details: string;
  };
  client: {
    name: string;
    details: string;
  };
  number: string;
  date: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  items: LineItem[];
  taxPercent: number;
  notes: string;
  currency: string; // ISO 4217, e.g. USD
  locale: string; // used for number and date formatting, e.g. en-US
  accentColor: string; // #RRGGBB
  labels: Labels;
}

export const defaultLabels: Labels = {
  title: "INVOICE",
  invoiceNumber: "INVOICE #",
  date: "DATE",
  dueDate: "DUE DATE",
  billTo: "BILL TO",
  item: "ITEM",
  quantity: "QTY",
  rate: "RATE",
  amount: "AMOUNT",
  subtotal: "Subtotal",
  tax: "Tax",
  total: "Total",
  notes: "NOTES",
};

export function defaultInvoice(today = new Date()): Invoice {
  return {
    sender: { name: "", details: "" },
    client: { name: "", details: "" },
    number: "0001",
    date: isoDate(today),
    dueDate: isoDate(addDays(today, 26)),
    items: [{ description: "Software development services", quantity: 0, rate: 0 }],
    taxPercent: 0,
    notes: "",
    currency: "USD",
    locale: "en-US",
    accentColor: "#B04A2F",
    labels: { ...defaultLabels },
  };
}

export function lineAmount(item: LineItem): number {
  return round2((item.quantity || 0) * (item.rate || 0));
}

export function totals(invoice: Invoice) {
  const subtotal = round2(invoice.items.reduce((sum, item) => sum + lineAmount(item), 0));
  const tax = round2((subtotal * (invoice.taxPercent || 0)) / 100);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

export function formatMoney(value: number, invoice: Pick<Invoice, "currency" | "locale">): string {
  try {
    return new Intl.NumberFormat(invoice.locale || "en-US", {
      style: "currency",
      currency: invoice.currency || "USD",
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${invoice.currency}`;
  }
}

export function formatQuantity(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale || "en-US", { maximumFractionDigits: 2 }).format(value || 0);
  } catch {
    return String(value || 0);
  }
}

export function formatDate(iso: string, locale: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  try {
    return new Intl.DateTimeFormat(locale || "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(date);
  } catch {
    return iso;
  }
}

// "0003" -> "0004", "INV-9" -> "INV-10"; keeps zero padding.
export function nextInvoiceNumber(current: string): string {
  const match = current.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return current;
  const [, prefix, digits, suffix] = match;
  const next = String(Number(digits) + 1).padStart(digits.length, "0");
  return `${prefix}${next}${suffix}`;
}

export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
