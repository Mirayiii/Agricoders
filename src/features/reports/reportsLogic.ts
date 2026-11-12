// Report periods, chart buckets, CSV and the customer statement, kept free of
// React and native modules so they can be tested.

import { escapeHtml, pdfPage } from "@/services/pdfHtml";
import { ORDER_STATUS_META } from "@/features/orders/status";
import type { OrderStatus } from "@/types/orders";

export type Period = "today" | "week" | "month" | "quarter" | "year";
export type Range = { start: string; end: string };

export const PERIODS: { key: Period; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

export function isPeriod(value: unknown): value is Period {
  return value === "today" || value === "week" || value === "month" || value === "quarter" || value === "year";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m, d));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
const parts = (value: string) => value.split("-").map(Number) as [number, number, number];
export const addDays = (value: string, days: number) => { const [y, m, d] = parts(value); return iso(y, m - 1, d + days); };
const weekday = (value: string) => { const [y, m, d] = parts(value); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

/**
 * The period containing `today` (Manila date), moved back `back` periods.
 * Weeks run Sunday to Saturday, as in Figma's chart.
 */
export function periodRange(period: Period, today: string, back = 0): Range {
  const [y, m] = parts(today);
  if (period === "today") { const day = addDays(today, -back); return { start: day, end: day }; }
  if (period === "week") {
    const start = addDays(today, -weekday(today) - 7 * back);
    return { start, end: addDays(start, 6) };
  }
  if (period === "month") return { start: iso(y, m - 1 - back, 1), end: iso(y, m - back, 0) };
  if (period === "quarter") {
    const q = Math.floor((m - 1) / 3) - back;
    return { start: iso(y, q * 3, 1), end: iso(y, q * 3 + 3, 0) };
  }
  return { start: iso(y - back, 0, 1), end: iso(y - back, 11, 31) };
}

/** "Aug 23 – 29", "Aug 30 – Sep 5", "Aug 2026", "Jul – Sep 2026", "2026". */
export function rangeLabel(period: Period, range: Range): string {
  const [sy, sm, sd] = parts(range.start);
  const [ey, em, ed] = parts(range.end);
  if (period === "today") return `${MONTHS[sm - 1]} ${sd}, ${sy}`;
  if (period === "month") return `${MONTHS[sm - 1]} ${sy}`;
  if (period === "quarter") return `${MONTHS[sm - 1]} – ${MONTHS[em - 1]} ${ey}`;
  if (period === "year") return String(sy);
  return sm === em ? `${MONTHS[sm - 1]} ${sd} – ${ed}` : `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}`;
}

/** Longest range the date picker allows on reports (the server returns daily points up to about 400 days). */
export const MAX_REPORT_DAYS = 366;

const isIsoDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && iso(...toYmd(value)) === value;
const toYmd = (value: string): [number, number, number] => { const [y, m, d] = parts(value); return [y, m - 1, d]; };
const dayCount = (range: Range) => { const [sy, sm, sd] = parts(range.start); const [ey, em, ed] = parts(range.end); return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1; };

/** A range picked on the calendar, as "Nov 19 – 25", "Nov 19 – Dec 2", "Nov 19" or "Dec 28, 2026 – Jan 3, 2027". */
export function customRangeLabel(range: Range): string {
  const [sy, sm, sd] = parts(range.start);
  const [ey, em, ed] = parts(range.end);
  if (range.start === range.end) return `${MONTHS[sm - 1]} ${sd}, ${sy}`;
  if (sy !== ey) return `${MONTHS[sm - 1]} ${sd}, ${sy} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
  return sm === em ? `${MONTHS[sm - 1]} ${sd} – ${ed}, ${sy}` : `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}, ${sy}`;
}

/** Number of days in a range, counting both ends. */
export function rangeDays(range: Range): number {
  return dayCount(range);
}

/**
 * If a picked range is exactly one of the offered periods (this week, last
 * month, Q3...), that period and how far back it is, so its tab lights up.
 */
export function matchPeriod(range: Range, today: string, periods: Period[]): { period: Period; back: number } | null {
  for (const period of periods) {
    for (let back = 0; back < 1000; back += 1) {
      const candidate = periodRange(period, today, back);
      if (candidate.start === range.start && candidate.end === range.end) return { period, back };
      if (candidate.end < range.start) break;
    }
  }
  return null;
}

/** How to group a picked range on the chart: days up to a month, weeks up to a quarter, then months. */
export function chartPeriodFor(range: Range): Period {
  const days = dayCount(range);
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  if (days <= 93) return "quarter";
  return "year";
}

/** A picked range from route params, or null when missing or invalid. */
export function parseRange(start: unknown, end: unknown): Range | null {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return null;
  const range = { start, end };
  return dayCount(range) <= MAX_REPORT_DAYS ? range : null;
}

export const PERIOD_NOUN: Record<Period, string> = { today: "Today", week: "This week", month: "This month", quarter: "This quarter", year: "This year" };

export type DailyPoint = { date: string; sales?: number; volume?: number };
export type Bar = { label: string; value: number; key: string };

/**
 * Chart bars for a period: days for a week or month, weeks for a quarter,
 * months for a year. "trend" shows the running total instead.
 */
export function chartBars(period: Period, daily: DailyPoint[], measure: "sales" | "volume", mode: "period" | "trend" = "period"): Bar[] {
  const value = (point: DailyPoint) => Number(point[measure] ?? 0);
  let bars: Bar[];
  if (period === "week" || period === "today") {
    bars = daily.map((point) => ({ key: point.date, label: DAYS[weekday(point.date)], value: value(point) }));
  } else if (period === "month") {
    bars = daily.map((point) => ({ key: point.date, label: String(Number(point.date.slice(8, 10))), value: value(point) }));
  } else if (period === "quarter") {
    bars = [];
    daily.forEach((point, index) => {
      if (index % 7 === 0) bars.push({ key: point.date, label: `W${bars.length + 1}`, value: 0 });
      bars[bars.length - 1].value += value(point);
    });
  } else {
    const byMonth = new Map<string, Bar>();
    for (const point of daily) {
      const key = point.date.slice(0, 7);
      const bar = byMonth.get(key) ?? { key, label: MONTHS[Number(point.date.slice(5, 7)) - 1], value: 0 };
      bar.value += value(point);
      byMonth.set(key, bar);
    }
    bars = [...byMonth.values()];
  }
  bars = bars.map((bar) => ({ ...bar, value: Math.round(bar.value * 1000) / 1000 }));
  if (mode === "trend") {
    let total = 0;
    bars = bars.map((bar) => ({ ...bar, value: Math.round((total += bar.value) * 1000) / 1000 }));
  }
  return bars;
}

/** "12.5k", "425", "1.2M" above a bar. */
export function compact(value: number, suffix = ""): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M${suffix}`;
  if (abs >= 1000) return `${trim(value / 1000)}k${suffix}`;
  return `${trim(value)}${suffix}`;
}
const trim = (value: number) => String(Math.round(value * 10) / 10);

/** "₱34.6k" for stat tiles. */
export function compactMoney(value: number): string {
  return Math.abs(value) >= 10000 ? `₱${compact(value)}` : `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type Volume = { unit: string; quantity: number };

/** "337 kg", "337 kg · 24 pc": compatible units are already added together. */
export function volumeText(volume: Volume[], max = 2): string {
  if (!volume.length) return "0 kg";
  const shown = volume.slice(0, max).map((v) => `${trim(Number(v.quantity))} ${v.unit}`);
  return volume.length > max && max > 1 ? `${shown.join(" · ")} +${volume.length - max}` : shown.join(" · ");
}

export type Totals = {
  sales: number;
  orders: number;
  covered_sales: number;
  cost: number;
  profit: number;
  margin_percent: number | null;
  lines_without_cost: number;
  volume: Volume[];
};

/** "24.2%", or a dash when no cost is recorded. */
export function formatPercentOrDash(value: number | null): string {
  return value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}%`;
}

/** "Profit: +₱8,387.00", with a note when some lines have no cost recorded. */
export function profitLine(totals: Totals, money: (value: number) => string): string {
  if (totals.margin_percent === null) return totals.lines_without_cost ? "No costs recorded" : "No sales";
  const sign = totals.profit < 0 ? "−" : "+";
  return `Profit: ${sign}${money(Math.abs(Number(totals.profit)))}`;
}

export function costNote(totals: Totals): string | null {
  if (!totals.lines_without_cost) return null;
  const n = totals.lines_without_cost;
  return `${n} line${n === 1 ? " has" : "s have"} no cost recorded, so ${n === 1 ? "it is" : "they are"} left out of cost, profit and margin.`;
}

/** Bar width for a list row, against the biggest value. */
export function share(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (value: string | number | null) => {
    const text = value === null ? "" : String(value);
    // Leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}

export type StatementLine = { product_name: string; quantity: number; unit: string; unit_price: number; amount: number };
export type StatementOrder = {
  order_id: string;
  order_number: string;
  status: OrderStatus;
  delivery_date: string;
  dr_number: number | string | null;
  sales_invoice_number: string | null;
  received_by: string | null;
  subtotal: number;
  discount: number;
  total: number;
  lines: StatementLine[];
};
export type Statement = {
  customer: { id: string; name: string; business_name: string; brand_name: string | null; tin: string | null; code: string; contact_person: string | null; phone: string | null; delivery_address: string | null };
  start: string;
  end: string;
  totals: Totals;
  daily: DailyPoint[];
  orders: StatementOrder[];
};

export function drLabel(value: number | string | null): string | null {
  if (value === null || value === undefined || value === "") return null;
  return `DR-${String(value).padStart(4, "0")}`;
}

export function statementCsv(statement: Statement): string {
  const rows: (string | number | null)[][] = [];
  for (const order of statement.orders) {
    for (const line of order.lines) {
      rows.push([order.delivery_date, order.order_number, drLabel(order.dr_number), ORDER_STATUS_META[order.status]?.label ?? order.status, line.product_name, line.quantity, line.unit, Number(line.unit_price).toFixed(2), Number(line.amount).toFixed(2)]);
    }
    if (Number(order.discount)) rows.push([order.delivery_date, order.order_number, drLabel(order.dr_number), "Discount", "", "", "", "", (-Number(order.discount)).toFixed(2)]);
  }
  return toCsv(["Delivery date", "Order", "DR", "Status", "Product", "Quantity", "Unit", "Unit price", "Amount"], rows);
}

const peso = (value: number) => `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (value: string) => { const [y, m, d] = parts(value); return `${MONTHS[m - 1]} ${d}, ${y}`; };

/**
 * Prototype "Share Statement (Viber / SMS)": a plain-text proof of billing to paste into a chat.
 * Jac (8 Nov): no 1% withholding and no BIR 2307 note for now, so the amount due is the total billed.
 */
export function statementText(statement: Statement, businessName: string, periodLabel?: string): string {
  const billed = statement.orders.reduce((sum, order) => sum + Number(order.total), 0);
  const rule = "--------------------------------";
  const period = periodLabel ?? `${longDate(statement.start)} – ${longDate(statement.end)}`;
  const lines = [
    `${businessName.toUpperCase()} — PROOF OF BILLING`,
    `Customer: ${statement.customer.name}`,
    `Billing Period: ${period}`,
    rule,
    `Total Amount Due: ${peso(billed)}`,
    rule,
    "DELIVERIES BREAKDOWN:",
  ];
  if (!statement.orders.length) lines.push("No orders in this period.");
  for (const order of statement.orders) {
    const status = ORDER_STATUS_META[order.status]?.label ?? order.status;
    lines.push(`${longDate(order.delivery_date)} (${drLabel(order.dr_number) ?? order.order_number}) - ${peso(order.total)} [${status}]`);
    for (const line of order.lines) lines.push(`  • ${line.product_name} (${Number(line.quantity)} ${line.unit}): ${peso(line.amount)}`);
    if (Number(order.discount)) lines.push(`  • Discount: −${peso(order.discount)}`);
  }
  lines.push(rule, `Exact amount to collect: ${peso(billed)}. Thank you!`);
  return lines.join("\n");
}

/**
 * Customer statement as a printable page: every order in
 * the period that isn't cancelled, itemized, with discounts and the total.
 */
export function statementHtml(statement: Statement, businessName: string, printedAt: string): string {
  const c = statement.customer;
  const billed = statement.orders.reduce((sum, order) => sum + Number(order.total), 0);
  const orders = statement.orders.length
    ? statement.orders.map((order) => {
      const lines = order.lines.map((line) => `<tr><td>${escapeHtml(line.product_name)}</td><td class="num">${escapeHtml(line.quantity)} ${escapeHtml(line.unit)}</td><td class="num">${peso(line.unit_price)}</td><td class="num">${peso(line.amount)}</td></tr>`).join("");
      const discount = Number(order.discount) ? `<tr><td colspan="3">Discount</td><td class="num">−${peso(order.discount)}</td></tr>` : "";
      const meta = [drLabel(order.dr_number), order.sales_invoice_number ? `Sales invoice ${order.sales_invoice_number}` : null, ORDER_STATUS_META[order.status]?.label ?? order.status, order.received_by ? `Received by ${order.received_by}` : null].filter(Boolean).map(escapeHtml).join(" · ");
      return `<h3>${escapeHtml(longDate(order.delivery_date))} · ${escapeHtml(order.order_number)}</h3><p class="muted">${meta}</p>
<table><colgroup><col style="width:52%"><col style="width:16%"><col style="width:16%"><col style="width:16%"></colgroup><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>${lines}${discount}
<tr><td colspan="3"><b>Order total</b></td><td class="num"><b>${peso(order.total)}</b></td></tr></tbody></table>`;
    }).join("")
    : `<p class="muted">No orders in this period.</p>`;
  const identity = [c.brand_name && c.brand_name !== c.business_name ? `Business name: ${c.business_name}` : null, c.tin ? `TIN#: ${c.tin}` : null, c.code ? `Customer code: ${c.code}` : null, c.delivery_address].filter(Boolean).map(escapeHtml).join("<br>");
  const body = `<h1>Customer statement</h1>
<p class="muted">${escapeHtml(businessName)} · Printed ${escapeHtml(printedAt)}</p>
<h2>${escapeHtml(c.name)}</h2><p>${identity}</p>
<p><b>Period:</b> ${escapeHtml(longDate(statement.start))} – ${escapeHtml(longDate(statement.end))} · <b>${statement.orders.length}</b> order${statement.orders.length === 1 ? "" : "s"} · <b>Total billed: ${peso(billed)}</b></p>
<p class="muted">Lists every order delivered or scheduled in the period except cancelled ones. Amounts are after discounts.</p>
${orders}
<p style="margin-top:18px"><b>Total billed: ${peso(billed)}</b></p>`;
  return pdfPage(`Statement ${c.name} ${statement.start} to ${statement.end}`, body);
}
