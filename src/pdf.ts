import { PDFDocument, PDFFont, PDFPage, rgb, RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  Invoice,
  formatDate,
  formatMoney,
  formatQuantity,
  lineAmount,
  totals,
} from "./invoice";

export interface FontBytes {
  serifBold: ArrayBuffer | Uint8Array;
  sans: ArrayBuffer | Uint8Array;
  sansMedium: ArrayBuffer | Uint8Array;
  mono: ArrayBuffer | Uint8Array;
  monoBold: ArrayBuffer | Uint8Array;
}

export const fontFiles: Record<keyof FontBytes, string> = {
  serifBold: "Lora-Bold.ttf",
  sans: "Inter-Regular.ttf",
  sansMedium: "Inter-Medium.ttf",
  mono: "JetBrainsMono-Regular.ttf",
  monoBold: "JetBrainsMono-Bold.ttf",
};

type Fonts = Record<keyof FontBytes, PDFFont>;

// A4 in points. All layout below uses "top" coordinates (distance from the top
// edge) and converts at draw time, because pdf-lib's origin is bottom-left.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const PANEL_X = 34;
const PANEL_TOP = 34;
const PANEL_W = PAGE_W - PANEL_X * 2;
const LEFT = 61;
const RIGHT = PAGE_W - 61;
const PAGE_BOTTOM_LIMIT = PAGE_H - 70;

const COL_ITEM = LEFT + 7;
const COL_QTY_RIGHT = 383;
const COL_RATE_RIGHT = 443;
const COL_AMOUNT_RIGHT = RIGHT - 7;
const TOTALS_LEFT = 340;

const INK = rgb(0.13, 0.12, 0.11);
const MUTED = rgb(0.42, 0.39, 0.37);
const HAIRLINE = rgb(0.9, 0.86, 0.83);
const PANEL = rgb(0.98, 0.973, 0.961);

type DrawOp = (page: PDFPage) => void;

class Layout {
  pages: { ops: DrawOp[]; bottom: number }[] = [{ ops: [], bottom: PANEL_TOP }];

  get current() {
    return this.pages[this.pages.length - 1];
  }

  newPage() {
    this.pages.push({ ops: [], bottom: PANEL_TOP });
  }

  draw(bottom: number, op: DrawOp) {
    this.current.ops.push(op);
    this.current.bottom = Math.max(this.current.bottom, bottom);
  }
}

export async function renderInvoicePdf(invoice: Invoice, fontBytes: FontBytes): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${invoice.labels.title} ${invoice.number}`.trim());
  doc.setAuthor(invoice.sender.name);
  doc.setCreator("invoice-generator");
  doc.setProducer("invoice-generator");

  const fonts = {} as Fonts;
  for (const key of Object.keys(fontFiles) as (keyof FontBytes)[]) {
    fonts[key] = await doc.embedFont(fontBytes[key], { subset: true });
  }

  const accent = hexToRgb(invoice.accentColor);
  const layout = new Layout();
  const { labels } = invoice;

  // Header, left: sender
  let leftY = 75;
  if (invoice.sender.name) {
    text(layout, invoice.sender.name, LEFT, leftY, fonts.serifBold, 13.5, INK);
  }
  leftY += 17;
  for (const line of wrap(invoice.sender.details, fonts.sans, 9.5, 260)) {
    text(layout, line, LEFT, leftY, fonts.sans, 9.5, MUTED);
    leftY += 15.5;
  }

  // Header, right: title and meta
  const title = labels.title;
  spaced(layout, title, RIGHT, 84, fonts.serifBold, 22, accent, 0.8, "right");
  let rightY = 104;
  const meta: [string, string][] = [
    [labels.invoiceNumber, invoice.number],
    [labels.date, formatDate(invoice.date, invoice.locale)],
    [labels.dueDate, formatDate(invoice.dueDate, invoice.locale)],
  ];
  for (const [label, value] of meta) {
    if (!value) continue;
    const valueWidth = fonts.sans.widthOfTextAtSize(value, 9.5);
    text(layout, value, RIGHT - valueWidth, rightY, fonts.sans, 9.5, INK);
    spaced(layout, label, RIGHT - valueWidth - 3.5, rightY, fonts.sans, 7.8, MUTED, 0.6, "right");
    rightY += 17;
  }

  // Divider
  const ruleY = Math.max(leftY - 15.5, rightY - 17) + 20;
  line(layout, LEFT, RIGHT, ruleY, accent, 1.2);

  // Bill to
  let y = ruleY + 19;
  spaced(layout, labels.billTo, LEFT, y, fonts.sans, 7.8, MUTED, 0.6);
  y += 16;
  if (invoice.client.name) {
    text(layout, invoice.client.name, LEFT, y, fonts.sansMedium, 11, INK);
  }
  y += 16;
  for (const l of wrap(invoice.client.details, fonts.sans, 9.5, 300)) {
    text(layout, l, LEFT, y, fonts.sans, 9.5, MUTED);
    y += 15.5;
  }

  // Items table
  y += 22;
  const tableHeader = (top: number) => {
    const size = 8;
    const spacing = 0.9;
    spaced(layout, labels.item, COL_ITEM, top, fonts.monoBold, size, MUTED, spacing);
    spaced(layout, labels.quantity, COL_QTY_RIGHT, top, fonts.monoBold, size, MUTED, spacing, "right");
    spaced(layout, labels.rate, COL_RATE_RIGHT, top, fonts.monoBold, size, MUTED, spacing, "right");
    spaced(layout, labels.amount, COL_AMOUNT_RIGHT, top, fonts.monoBold, size, MUTED, spacing, "right");
    line(layout, LEFT, RIGHT, top + 13, HAIRLINE, 0.75);
    return top + 13;
  };
  let rowTop = tableHeader(y);

  const descWidth = COL_QTY_RIGHT - 50 - COL_ITEM;
  for (const item of invoice.items) {
    const descLines = wrap(item.description, fonts.sans, 10, descWidth);
    if (descLines.length === 0) descLines.push("");
    const rowHeight = 15.5 + (descLines.length - 1) * 14 + 13.5;
    if (rowTop + rowHeight > PAGE_BOTTOM_LIMIT) {
      layout.newPage();
      rowTop = tableHeader(PANEL_TOP + 40);
    }
    const baseline = rowTop + 15.5;
    descLines.forEach((l, i) => text(layout, l, COL_ITEM, baseline + i * 14, fonts.sans, 10, INK));
    rightText(layout, formatQuantity(item.quantity, invoice.locale), COL_QTY_RIGHT, baseline, fonts.mono, 10, INK);
    rightText(layout, formatMoney(item.rate || 0, invoice), COL_RATE_RIGHT, baseline, fonts.mono, 10, INK);
    rightText(layout, formatMoney(lineAmount(item), invoice), COL_AMOUNT_RIGHT, baseline, fonts.mono, 10, INK);
    rowTop += rowHeight;
    line(layout, LEFT, RIGHT, rowTop, HAIRLINE, 0.75);
  }

  // Totals
  const sums = totals(invoice);
  const totalsHeight = 25 + (sums.tax ? 20 : 0) + 17 + 19;
  if (rowTop + totalsHeight > PAGE_BOTTOM_LIMIT) {
    layout.newPage();
    rowTop = PANEL_TOP + 20;
  }
  y = rowTop + 25;
  text(layout, labels.subtotal, TOTALS_LEFT, y, fonts.sans, 9.5, MUTED);
  rightText(layout, formatMoney(sums.subtotal, invoice), RIGHT, y, fonts.mono, 10, INK);
  if (sums.tax) {
    y += 20;
    const taxLabel = `${labels.tax} (${formatQuantity(invoice.taxPercent, invoice.locale)}%)`;
    text(layout, taxLabel, TOTALS_LEFT, y, fonts.sans, 9.5, MUTED);
    rightText(layout, formatMoney(sums.tax, invoice), RIGHT, y, fonts.mono, 10, INK);
  }
  y += 17;
  line(layout, TOTALS_LEFT, RIGHT, y, accent, 1.5);
  y += 19;
  text(layout, labels.total, TOTALS_LEFT, y, fonts.serifBold, 13, INK);
  rightText(layout, formatMoney(sums.total, invoice), RIGHT, y, fonts.monoBold, 14, accent);

  // Notes / payment details
  const noteLines = wrap(invoice.notes, fonts.sans, 9, RIGHT - LEFT);
  if (noteLines.length) {
    y += 36;
    if (y + 16 + noteLines.length * 14 > PAGE_BOTTOM_LIMIT) {
      layout.newPage();
      y = PANEL_TOP + 40;
    }
    spaced(layout, labels.notes, LEFT, y, fonts.sans, 7.8, MUTED, 0.6);
    y += 16;
    for (const l of noteLines) {
      text(layout, l, LEFT, y, fonts.sans, 9, MUTED);
      y += 14;
    }
    y -= 14;
  }

  // Render: panel first so it sits behind the content.
  for (const { ops, bottom } of layout.pages) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const panelBottom = Math.min(bottom + 40, PAGE_H - PANEL_TOP);
    page.drawRectangle({
      x: PANEL_X,
      y: PAGE_H - panelBottom,
      width: PANEL_W,
      height: panelBottom - PANEL_TOP,
      color: PANEL,
    });
    ops.forEach((op) => op(page));
  }

  return doc.save();
}

function text(layout: Layout, value: string, x: number, top: number, font: PDFFont, size: number, color: RGB) {
  if (!value) return;
  const safe = sanitize(value, font);
  layout.draw(top + size * 0.3, (page) => page.drawText(safe, { x, y: PAGE_H - top, size, font, color }));
}

function rightText(layout: Layout, value: string, right: number, top: number, font: PDFFont, size: number, color: RGB) {
  const safe = sanitize(value, font);
  text(layout, safe, right - font.widthOfTextAtSize(safe, size), top, font, size, color);
}

// Letter-spaced text, drawn glyph by glyph.
function spaced(
  layout: Layout,
  value: string,
  x: number,
  top: number,
  font: PDFFont,
  size: number,
  color: RGB,
  spacing: number,
  align: "left" | "right" = "left",
) {
  if (!value) return;
  const chars = [...sanitize(value, font)];
  const widths = chars.map((c) => font.widthOfTextAtSize(c, size));
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cursor = align === "right" ? x - total : x;
  chars.forEach((c, i) => {
    text(layout, c, cursor, top, font, size, color);
    cursor += widths[i] + spacing;
  });
}

function line(layout: Layout, x1: number, x2: number, top: number, color: RGB, thickness: number) {
  layout.draw(top, (page) =>
    page.drawLine({
      start: { x: x1, y: PAGE_H - top },
      end: { x: x2, y: PAGE_H - top },
      thickness,
      color,
    }),
  );
}

// Splits on explicit newlines, then word-wraps each paragraph to maxWidth.
export function wrap(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!value || !value.trim()) return [];
  const out: string[] = [];
  for (const paragraph of sanitize(value, font).replace(/\r/g, "").split("\n")) {
    const words = paragraph.split(/ +/);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
        current = candidate;
      } else {
        out.push(current);
        current = word;
      }
    }
    out.push(current);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

// Replace characters the embedded font has no glyph for, so they don't render as boxes.
const charsets = new WeakMap<PDFFont, Set<number>>();

function sanitize(value: string, font: PDFFont): string {
  let supported = charsets.get(font);
  if (!supported) {
    supported = new Set(font.getCharacterSet());
    charsets.set(font, supported);
  }
  return [...value.replace(/\t/g, " ")]
    .map((c) => (c === "\n" || supported.has(c.codePointAt(0)!) ? c : "?"))
    .join("");
}

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0.69, 0.29, 0.18);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
