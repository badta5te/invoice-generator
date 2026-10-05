import {
  Invoice,
  addDays,
  cyrillicFields,
  defaultInvoice,
  defaultLabels,
  formatMoney,
  isoDate,
  lineAmount,
  nextInvoiceNumber,
  totals,
} from "./invoice";
import { FontBytes, fontFiles, renderInvoicePdf } from "./pdf";

const STORAGE_KEY = "invoice-generator:current";
const HISTORY_KEY = "invoice-generator:history";
const HISTORY_LIMIT = 200;

interface HistoryEntry {
  savedAt: string;
  invoice: Invoice;
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const form = $<HTMLFormElement>("#form");
const itemsEl = $("#items");
const itemTemplate = $<HTMLTemplateElement>("#item-row");
const preview = $<HTMLIFrameElement>("#preview");
const statusEl = $("#status");

let invoice: Invoice = load();
let fontsPromise: Promise<FontBytes> | null = null;
let previewUrl: string | null = null;
let renderTimer: number | undefined;
let renderSeq = 0;

// Android Chrome and some others can't show a PDF in an iframe; offer a new tab instead.
const inlinePdf = navigator.pdfViewerEnabled !== false;
if (!inlinePdf) {
  preview.hidden = true;
  $("#preview-fallback").hidden = false;
}
$("#open-preview").addEventListener("click", async () => {
  const tab = window.open("", "_blank");
  const url = URL.createObjectURL(await buildPdf());
  if (tab) tab.location.href = url;
  else window.location.href = url;
});

// ---------- persistence ----------

function load(): Invoice {
  const stored = readJson<Partial<Invoice>>(STORAGE_KEY);
  return stored ? normalize(stored) : defaultInvoice();
}

// Fills in fields missing from older saves or imported files.
function normalize(data: Partial<Invoice>): Invoice {
  const base = defaultInvoice();
  return {
    ...base,
    ...data,
    sender: { ...base.sender, ...data.sender },
    client: { ...base.client, ...data.client },
    labels: { ...defaultLabels, ...data.labels },
    items: Array.isArray(data.items) && data.items.length ? data.items : base.items,
  };
}

function save() {
  writeJson(STORAGE_KEY, invoice);
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); the app still works for this session.
  }
}

function history(): HistoryEntry[] {
  return readJson<HistoryEntry[]>(HISTORY_KEY) ?? [];
}

function remember(entry: Invoice) {
  const entries = history().filter((e) => e.invoice.number !== entry.number);
  entries.unshift({ savedAt: new Date().toISOString(), invoice: structuredClone(entry) });
  writeJson(HISTORY_KEY, entries.slice(0, HISTORY_LIMIT));
  renderHistory();
}

// ---------- form binding ----------

function getPath(obj: any, path: string) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function setPath(obj: any, path: string, value: unknown) {
  const keys = path.split(".");
  const last = keys.pop()!;
  keys.reduce((acc, key) => acc[key], obj)[last] = value;
}

function fillForm() {
  form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-path]").forEach((el) => {
    const value = getPath(invoice, el.dataset.path!);
    el.value = value ?? "";
  });
  renderItems();
}

form.addEventListener("input", (event) => {
  const el = event.target as HTMLInputElement;
  if (el.dataset.path) {
    const value = el.type === "number" ? parseNumber(el.value) : el.value;
    setPath(invoice, el.dataset.path, value);
  } else if (el.dataset.item) {
    const row = el.closest<HTMLElement>(".item")!;
    const item = invoice.items[Number(row.dataset.index)];
    const key = el.dataset.item as "description" | "quantity" | "rate";
    if (key === "description") item.description = el.value;
    else item[key] = parseNumber(el.value);
    row.querySelector("output")!.textContent = formatMoney(lineAmount(item), invoice);
  } else {
    return;
  }
  changed();
});

function parseNumber(value: string): number {
  const n = parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function renderItems() {
  itemsEl.replaceChildren(
    ...invoice.items.map((item, index) => {
      const row = itemTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
      row.dataset.index = String(index);
      row.querySelector<HTMLInputElement>('[data-item="description"]')!.value = item.description;
      row.querySelector<HTMLInputElement>('[data-item="quantity"]')!.value = item.quantity ? String(item.quantity) : "";
      row.querySelector<HTMLInputElement>('[data-item="rate"]')!.value = item.rate ? String(item.rate) : "";
      row.querySelector("output")!.textContent = formatMoney(lineAmount(item), invoice);
      row.querySelector<HTMLButtonElement>(".remove")!.addEventListener("click", () => {
        invoice.items.splice(index, 1);
        if (!invoice.items.length) invoice.items.push({ description: "", quantity: 0, rate: 0 });
        renderItems();
        changed();
      });
      return row;
    }),
  );
}

$("#add-item").addEventListener("click", () => {
  const previous = invoice.items[invoice.items.length - 1];
  invoice.items.push({ description: "", quantity: 0, rate: previous?.rate ?? 0 });
  renderItems();
  itemsEl.querySelector<HTMLInputElement>(".item:last-child input")?.focus();
  changed();
});

$("#reset-labels").addEventListener("click", () => {
  invoice.labels = { ...defaultLabels };
  fillForm();
  changed();
});

$("#new-invoice").addEventListener("click", () => {
  if (!confirm(`Создать инвойс № ${nextInvoiceNumber(invoice.number)}? Реквизиты и строки сохранятся, даты обновятся.`)) return;
  const termDays = daysBetween(invoice.date, invoice.dueDate) ?? 26;
  const today = new Date();
  invoice = {
    ...structuredClone(invoice),
    number: nextInvoiceNumber(invoice.number),
    date: isoDate(today),
    dueDate: isoDate(addDays(today, termDays)),
  };
  fillForm();
  changed();
});

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

// ---------- history & import/export ----------

function renderHistory() {
  const entries = history();
  $("#history-count").textContent = entries.length ? `(${entries.length})` : "";
  $("#history").replaceChildren(
    ...entries.map((entry) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-item";
      const { total } = totals(entry.invoice);
      button.innerHTML = "<span></span><span></span><span></span>";
      const [num, client, sum] = button.querySelectorAll("span");
      num.textContent = `№ ${entry.invoice.number} · ${entry.invoice.date}`;
      client.textContent = entry.invoice.client.name || "—";
      sum.textContent = formatMoney(total, entry.invoice);
      button.addEventListener("click", () => {
        invoice = normalize(structuredClone(entry.invoice));
        fillForm();
        changed();
      });
      li.append(button);
      return li;
    }),
  );
}

$("#export-json").addEventListener("click", () => {
  const data = { current: invoice, history: history() };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "invoices-backup.json");
});

$<HTMLInputElement>("#import-json").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    // Accepts either a backup ({ current, history }) or a single invoice.
    if (data.current) {
      invoice = normalize(data.current);
      if (Array.isArray(data.history)) writeJson(HISTORY_KEY, data.history);
    } else {
      invoice = normalize(data);
    }
    fillForm();
    renderHistory();
    changed();
  } catch {
    alert("Не получилось прочитать файл.");
  }
});

// ---------- PDF ----------

function loadFonts(): Promise<FontBytes> {
  fontsPromise ??= (async () => {
    const entries = await Promise.all(
      Object.entries(fontFiles).map(async ([key, file]) => {
        const res = await fetch(`fonts/${file}`);
        if (!res.ok) throw new Error(`Font ${file}: ${res.status}`);
        return [key, await res.arrayBuffer()] as const;
      }),
    );
    return Object.fromEntries(entries) as unknown as FontBytes;
  })();
  return fontsPromise;
}

async function buildPdf(): Promise<Blob> {
  const bytes = await renderInvoicePdf(invoice, await loadFonts());
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

function changed() {
  save();
  $("#total").textContent = formatMoney(totals(invoice).total, invoice);
  markCyrillic();
  itemsEl.querySelectorAll<HTMLElement>(".item").forEach((row, index) => {
    row.querySelector("output")!.textContent = formatMoney(lineAmount(invoice.items[index]), invoice);
  });
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(refreshPreview, 300);
}

const fieldNames: Record<string, string> = {
  "sender.name": "имя отправителя",
  "sender.details": "реквизиты отправителя",
  "client.name": "компания клиента",
  "client.details": "реквизиты клиента",
  notes: "примечания",
};

// The invoice goes out in English; flag any field that still has Russian text.
function markCyrillic() {
  const paths = cyrillicFields(invoice);
  form.querySelectorAll(".cyrillic").forEach((el) => el.classList.remove("cyrillic"));
  for (const path of paths) {
    const [kind, index] = path.split(".");
    const el =
      kind === "items"
        ? itemsEl.querySelector(`.item[data-index="${index}"] [data-item="description"]`)
        : form.querySelector(`[data-path="${path}"]`);
    el?.classList.add("cyrillic");
  }
  const names = paths.map((path) => {
    const [kind, index] = path.split(".");
    if (kind === "items") return `строка работ ${Number(index) + 1}`;
    if (kind === "labels") return "подписи в PDF";
    return fieldNames[path] ?? path;
  });
  const warning = $("#lang-warning");
  warning.hidden = names.length === 0;
  warning.textContent = `В инвойсе есть русский текст: ${[...new Set(names)].join(", ")}. Инвойс уходит на английском, поправь подсвеченные поля.`;
}

async function refreshPreview() {
  if (!inlinePdf) return;
  const seq = ++renderSeq;
  try {
    const blob = await buildPdf();
    if (seq !== renderSeq) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    preview.src = `${previewUrl}#toolbar=0&navpanes=0&view=FitH`;
    statusEl.textContent = "";
  } catch (error) {
    console.error(error);
    statusEl.textContent = "Не удалось построить PDF. Подробности в консоли.";
  }
}

$("#download").addEventListener("click", async () => {
  try {
    const blob = await buildPdf();
    downloadBlob(blob, `invoice-${invoice.number || "draft"}.pdf`);
    remember(invoice);
  } catch (error) {
    console.error(error);
    alert("Не удалось построить PDF.");
  }
});

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

fillForm();
renderHistory();
changed();
