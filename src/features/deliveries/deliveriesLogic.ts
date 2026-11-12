import { escapeHtml, pdfPage } from "@/services/pdfHtml";
import { deliveryDay } from "@/features/purchasing/purchasingLogic";

// Deliveries (Phase 6): the rules the Deliveries tab and the receipt use,
// kept free of React so they can be tested. Dates are Manila dates.

export type DeliveryStatus = "scheduled" | "for_delivery" | "completed" | "cancelled";

export type StopRow = {
  id: string;
  order_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  status: DeliveryStatus;
  route_position: number | null;
  received_by: string | null;
  completed_at: string | null;
  assigned_driver_id: string | null;
  orders: {
    order_number: string;
    updated_at?: string;
    /** The order's own status: "for_preparation" while it is being repacked after an edit. */
    status?: string;
    packing_version?: number;
    delivery_time_start?: string | null;
    delivery_time_end?: string | null;
    customers: { business_name: string; brand_name?: string | null; contact_person: string | null; phone: string | null; delivery_address: string | null } | null;
    order_items: { id: string }[];
  } | null;
  profiles: { full_name: string | null; email: string } | null;
};

// ---------------------------------------------------------------------------
// Delivery time
// ---------------------------------------------------------------------------

const minutes = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
};

const clock = (total: number) => {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

/**
 * When the stop is due, in minutes after midnight. The time set on the
 * delivery comes first, then the time asked for on the order. Null when
 * neither has a time ("Not specified").
 */
export function stopWindow(stop: Pick<StopRow, "scheduled_time" | "orders">): { start: number; end: number | null } | null {
  const orderStart = stop.orders?.delivery_time_start ?? null;
  const orderEnd = stop.orders?.delivery_time_end ?? null;
  if (stop.scheduled_time) {
    const start = minutes(stop.scheduled_time);
    const end = orderEnd && minutes(orderEnd) > start ? minutes(orderEnd) : null;
    return { start, end };
  }
  if (!orderStart) return null;
  return { start: minutes(orderStart), end: orderEnd ? minutes(orderEnd) : null };
}

export function stopTimeText(stop: Pick<StopRow, "scheduled_time" | "orders">): string {
  const window = stopWindow(stop);
  if (!window) return "Not specified";
  return window.end === null ? clock(window.start) : `${clock(window.start)} – ${clock(window.end)}`;
}

/** Two stops overlap when their windows share time; a single time counts as that moment. */
function overlap(a: { start: number; end: number | null }, b: { start: number; end: number | null }): boolean {
  const aEnd = a.end ?? a.start;
  const bEnd = b.end ?? b.start;
  if (a.start === b.start) return true;
  return a.start < bEnd && b.start < aEnd;
}

/** Stops on the same route whose times overlap. Stops with no time are left out. */
export function overlappingStops(stops: Pick<StopRow, "id" | "scheduled_time" | "orders">[]): Set<string> {
  const timed = stops.flatMap((stop) => {
    const window = stopWindow(stop);
    return window ? [{ id: stop.id, window }] : [];
  });
  const ids = new Set<string>();
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      if (overlap(timed[i].window, timed[j].window)) {
        ids.add(timed[i].id);
        ids.add(timed[j].id);
      }
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const isOpen = (stop: Pick<StopRow, "status">) => stop.status === "scheduled" || stop.status === "for_delivery";

/** Route order: saved position first, then time, then order number. */
export function sortRoute<T extends Pick<StopRow, "route_position" | "scheduled_time" | "orders">>(stops: T[]): T[] {
  return [...stops].sort((a, b) => {
    const pa = a.route_position ?? Number.MAX_SAFE_INTEGER;
    const pb = b.route_position ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    const ta = stopWindow(a)?.start ?? Number.MAX_SAFE_INTEGER;
    const tb = stopWindow(b)?.start ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return (a.orders?.order_number ?? "").localeCompare(b.orders?.order_number ?? "");
  });
}

export type Route = { driverId: string | null; driverName: string; stops: StopRow[]; overlaps: Set<string> };

export const driverName = (stop: Pick<StopRow, "profiles">) => stop.profiles?.full_name?.trim() || stop.profiles?.email || "Unassigned";

/** Today's open stops, one route per driver; unassigned stops first. */
export function buildRoutes(stops: StopRow[]): Route[] {
  const byDriver = new Map<string, StopRow[]>();
  for (const stop of stops.filter(isOpen)) {
    const key = stop.assigned_driver_id ?? "";
    byDriver.set(key, [...(byDriver.get(key) ?? []), stop]);
  }
  return [...byDriver.entries()]
    .map(([key, list]) => {
      const sorted = sortRoute(list);
      return { driverId: key || null, driverName: key ? driverName(sorted[0]) : "Unassigned", stops: sorted, overlaps: overlappingStops(sorted) };
    })
    .sort((a, b) => (a.driverId === null ? -1 : b.driverId === null ? 1 : a.driverName.localeCompare(b.driverName)));
}

/** Move one stop up (-1) or down (+1) in an edited route. */
export function moveStop(ids: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Today (due today or late and still open), Upcoming, and Done. */
export function splitTabs(stops: StopRow[], today: string) {
  const open = stops.filter(isOpen);
  return {
    today: open.filter((stop) => stop.scheduled_date <= today),
    upcoming: sortByDayAndTime(open.filter((stop) => stop.scheduled_date > today)),
    done: stops.filter((stop) => stop.status === "completed").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")),
  };
}

function sortByDayAndTime(stops: StopRow[]): StopRow[] {
  return [...stops].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || (stopWindow(a)?.start ?? 9999) - (stopWindow(b)?.start ?? 9999));
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Figma Done card: "Yesterday · 9:15 AM", in Manila time. */
export function deliveredLabel(completedAt: string, today: string): string {
  const local = new Date(new Date(completedAt).getTime() + MANILA_OFFSET_MS);
  const date = local.toISOString().slice(0, 10);
  return `${deliveryDay(date, today)} · ${clock(local.getUTCHours() * 60 + local.getUTCMinutes())}`;
}

/** Figma Upcoming card: "Tomorrow · 7:00 AM", or "Tomorrow · Not specified". */
export function upcomingLabel(stop: Pick<StopRow, "scheduled_date" | "scheduled_time" | "orders">, today: string): string {
  return `${deliveryDay(stop.scheduled_date, today)} · ${stopTimeText(stop)}`;
}

export function driverStopsText(count: number): string {
  return count === 0 ? "Available" : `${count} ${count === 1 ? "stop" : "stops"} today`;
}

// ---------------------------------------------------------------------------
// Delivery receipt (Letter layout, D-D1)
// ---------------------------------------------------------------------------

export type ReceiptLine = { quantity: number; unit: string; description: string; unit_price: number; amount: number };
export type Receipt = {
  receipt_id: string;
  order_id: string;
  dr_number: number;
  dr_label: string;
  issued_at: string;
  /** Set when the delivery is completed (or the order cancelled); the receipt no longer changes. */
  finalized_at?: string | null;
  /** Set when the order was cancelled after the receipt was issued (DE-03): the receipt is VOID. */
  voided_at?: string | null;
  layout: "letter";
  company_name: string;
  company_address: string;
  company_phone: string;
  order_number: string;
  customer_name: string;
  delivery_address: string | null;
  delivery_date: string;
  sales_invoice_number: string | null;
  issued_by_name: string;
  lines: ReceiptLine[];
  subtotal: number;
  discount_amount: number;
  total: number;
};

/** "₱1,320.00". */
export function peso(value: number): string {
  const cents = Math.round(Number(value) * 100);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}₱${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * The delivery receipt exists from Confirmed onwards, with no Issue step
 * (MEAH-Prototype 2.html; Jac, 5 Nov). Its DR number is the order number.
 * Who can open it is checked by the server.
 */
export const RECEIPT_STATUSES: readonly string[] = ["confirmed", "for_preparation", "for_delivery", "completed"];

/**
 * Mark delivered (MEAH-Prototype 2.html, 5 Nov; replaces DE-04): the
 * administrator and administrative staff for any stop, delivery staff for
 * their own. No driver has to be assigned first. The server checks the same
 * on every route, offline sync included.
 */
export function canCompleteDelivery(role: string | null | undefined, assignedDriverId: string | null | undefined, myId: string | null | undefined): boolean {
  if (role === "administrator" || role === "administrative_staff") return true;
  return role === "delivery_staff" && Boolean(myId) && assignedDriverId === myId;
}

/** "0042"; numbers past 9999 keep every digit, like the server's dr_label. */
export const receiptNumber = (receipt: Pick<Receipt, "dr_number">) => String(receipt.dr_number).padStart(4, "0");

/** "10/14/26", as on MEAH's paper receipt. */
export function receiptDate(iso: string): string {
  const day = iso.length > 10 ? new Date(new Date(iso).getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10) : iso;
  const [y, m, d] = day.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

export const quantityText = (line: Pick<ReceiptLine, "quantity" | "unit">) => `${Number(line.quantity).toFixed(2)} ${line.unit}`;

/** DE-03 (Jac, 4 Nov): a receipt whose order was cancelled keeps its DR number and details, marked VOID. */
export const VOID_LABEL = "VOID — Order cancelled";
export const isVoidReceipt = (receipt: Pick<Receipt, "voided_at">) => Boolean(receipt.voided_at);

export function receiptFileName(receipt: Pick<Receipt, "dr_number" | "order_number" | "voided_at">): string {
  return `MEAH DR ${receiptNumber(receipt)} (${receipt.order_number})${isVoidReceipt(receipt) ? " VOID" : ""}`;
}

export const ROUNDING_NOTE = "Total as originally recorded; line amounts are rounded.";

/**
 * Orders created before the rollout keep their old, unrounded totals, so their
 * rounded line amounts can differ from the subtotal by a centavo (Jac, 4 Nov).
 * Only those receipts get the note.
 */
export function roundingNote(receipt: Pick<Receipt, "lines" | "subtotal">): string | null {
  const cents = (value: number) => Math.round(Number(value) * 100);
  const lines = receipt.lines.reduce((sum, line) => sum + cents(line.amount), 0);
  return lines === cents(receipt.subtotal) ? null : ROUNDING_NOTE;
}

/** The receipt as printed: MEAH's Letter delivery receipt. Uses only the saved contents. */
export function receiptHtml(receipt: Receipt): string {
  const e = escapeHtml;
  const rows = receipt.lines
    .map((line) => `<tr><td class="c">${e(quantityText(line))}</td><td>${e(line.description)}</td><td class="c">${e(peso(line.unit_price))}</td><td class="c">${e(peso(line.amount))}</td></tr>`)
    .join("");
  const discount = Number(receipt.discount_amount) > 0
    ? `<tr><td colspan="3" class="r b">SUBTOTAL:</td><td class="c">${e(peso(receipt.subtotal))}</td></tr><tr><td colspan="3" class="r b">LESS DISCOUNT:</td><td class="c">-${e(peso(receipt.discount_amount))}</td></tr>`
    : "";
  const note = roundingNote(receipt);
  const si = receipt.sales_invoice_number ? ` · SI# ${e(receipt.sales_invoice_number)}` : "";
  const body = `<style>
  @page { size: letter; margin: 0.5in; }
  body { font-size: 13px; }
  .head { text-align: center; margin-bottom: 18px; }
  .head h1 { font-size: 19px; letter-spacing: .2px; margin: 0; }
  .head p { margin: 4px 0 0; font-size: 10px; text-transform: uppercase; }
  table.box { width: 100%; border-collapse: collapse; margin: 0; }
  table.box td, table.box th { border: 1.5px solid #000; padding: 4px 6px; }
  table.items th { font-size: 13px; text-align: center; color: #000; text-transform: uppercase; letter-spacing: 0; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
  .title { text-align: center; font-weight: 700; font-size: 14px; padding: 4px 0; }
  .total td { font-weight: 700; font-size: 14px; }
  .sign { display: flex; justify-content: space-between; margin-top: 26px; font-size: 9px; }
  .sign div { width: 1.6in; text-align: center; }
  .sign .line { border-top: 1px solid #000; padding-top: 2px; }
  .note { margin: 6px 0 0; font-size: 10px; font-style: italic; text-align: right; }
  .ref { margin-top: 18px; font-size: 9px; color: #5B6B62; }
  .void { border: 3px solid #B42318; color: #B42318; font-weight: 700; font-size: 22px; text-align: center; padding: 6px; margin: 0 0 12px; letter-spacing: 1px; }
  .voidmark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 110px; font-weight: 700; color: rgba(180, 35, 24, .16); transform: rotate(-30deg); pointer-events: none; }
</style>
${isVoidReceipt(receipt) ? `<div class="voidmark">VOID</div><div class="void">${e(VOID_LABEL)}</div>` : ""}
<div class="head"><h1>${e(receipt.company_name)}</h1><p>${e(receipt.company_address)} / ${e(receipt.company_phone)}</p></div>
<table class="box"><tr>
  <td style="width:1.3in"><span class="b">DR NO:</span> ${e(receiptNumber(receipt))}</td>
  <td><span class="b" style="font-size:11px">Name:</span> ${e(receipt.customer_name)}</td>
  <td style="width:1.5in"><span class="b">DATE</span> : ${e(receiptDate(receipt.delivery_date))}</td>
</tr><tr><td colspan="3"><span class="b">ADDRESS:</span> ${e(receipt.delivery_address ?? "")}</td></tr></table>
<div class="title">DELIVERY RECEIPT</div>
<table class="box items"><thead><tr><th style="width:1.1in">QTY</th><th>DESCRIPTION</th><th style="width:1.2in">PRICE</th><th style="width:1.4in">AMOUNT</th></tr></thead>
<tbody>${rows}${discount}<tr class="total"><td colspan="3" class="r">TOTAL SALES:</td><td class="c">${e(peso(receipt.total))}</td></tr></tbody></table>
${note ? `<p class="note">${e(note)}</p>` : ""}
<div class="sign"><div><div style="text-align:left">${e(receipt.issued_by_name)}</div><div class="line">Issued By</div></div><div><div>&nbsp;</div><div class="line">Received By</div></div></div>
<p class="ref">${e(receipt.order_number)}${si} · Issued ${e(receiptDate(receipt.issued_at))}</p>`;
  return pdfPage(receiptFileName(receipt), body);
}

/** The order was changed after packing and is back in Packing: the stop stays booked but can't be marked delivered yet. */
export function stopIsRepacking(stop: { status: string; orders?: { status?: string } | null }): boolean {
  return (stop.status === "scheduled" || stop.status === "for_delivery") && stop.orders?.status === "for_preparation";
}
