// Purchasing (Phase 5): the rules To pack and To buy use, kept free of React
// so they can be tested. All dates are Manila calendar dates ("YYYY-MM-DD").

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8, no daylight saving
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Today's date in Manila, whatever time zone the phone is set to. */
export function manilaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

const toUtc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDaysIso(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Calendar days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

const parts = (iso: string) => {
  const date = new Date(toUtc(iso));
  return { day: date.getUTCDate(), month: date.getUTCMonth(), year: date.getUTCFullYear(), weekday: date.getUTCDay() };
};

/** "Sun, 30 Aug" (Figma's date on To pack). */
export function shortDate(iso: string): string {
  const p = parts(iso);
  return `${WEEKDAYS[p.weekday]}, ${p.day} ${MONTHS[p.month]}`;
}

/** "Aug 23, 2026". */
export function longDate(iso: string): string {
  const p = parts(iso);
  return `${MONTHS[p.month]} ${p.day}, ${p.year}`;
}

export function monthTitle(year: number, month: number): string {
  return `${LONG_MONTHS[month]} ${year}`;
}

/** "Aug 27 – 28", or "Aug 30 – Sep 2" across months, or "Aug 27" for one day. */
export function rangeText(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  if (from === to) return `${MONTHS[a.month]} ${a.day}`;
  if (a.month === b.month && a.year === b.year) return `${MONTHS[a.month]} ${a.day} – ${b.day}`;
  return `${MONTHS[a.month]} ${a.day} – ${MONTHS[b.month]} ${b.day}`;
}

/** The delivery day on a card: "Today", "Tomorrow", "Yesterday" or "Sun, 30 Aug". */
export function deliveryDay(iso: string, today: string): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return shortDate(iso);
}

/** Provisional (D-P1): an advance order is due after tomorrow, in Manila. */
export function isAdvanceOrder(deliveryDate: string, today: string): boolean {
  return daysBetween(today, deliveryDate) > 1;
}

// ---------------------------------------------------------------------------
// To pack
// ---------------------------------------------------------------------------

export type PackStatus = "pending" | "in_progress" | "completed";
export type PackLine = {
  id: string;
  quantity: number;
  unit_of_measurement: string;
  notes: string | null;
  /** Set when the line's note changed after packing started; cleared when the line is ticked again. */
  note_changed_at?: string | null;
  preparation_status: PackStatus;
  products: { product_name: string } | null;
};
/** A packed item taken off the order by an edit. Packing staff confirm it was taken out of the prepared order. */
export type PackRemoval = { id: string; description: string; quantity: number; unit_of_measurement: string; removed_at: string; confirmed_at: string | null };
export type PackOrder = {
  id: string;
  order_number: string;
  requested_delivery_date: string;
  status: "confirmed" | "for_preparation";
  delivery_time_start?: string | null;
  delivery_time_end?: string | null;
  customers: { business_name: string; brand_name?: string | null; delivery_address: string | null } | null;
  /** Goes up each time an edit changes what has to be packed; sent with every tick. */
  packing_version: number;
  order_items: PackLine[];
  order_item_removals?: PackRemoval[] | null;
  deliveries?: { id: string; status: string }[] | null;
};

export function packedCount(order: PackOrder): number {
  return order.order_items.filter((line) => line.preparation_status === "completed").length;
}

/** Removed packed items still waiting for packing staff to confirm they were taken out. */
export function removalsToConfirm(order: Pick<PackOrder, "order_item_removals">): PackRemoval[] {
  return (order.order_item_removals ?? []).filter((removal) => !removal.confirmed_at);
}

/** Being packed again after an edit: it already had a delivery booked when it was sent back to Packing. */
export function isRepacking(order: Pick<PackOrder, "status" | "deliveries">): boolean {
  return order.status === "for_preparation" && (order.deliveries ?? []).some((delivery) => delivery.status === "scheduled" || delivery.status === "for_delivery");
}

/** Packing now (being packed) and Ready to start (confirmed), soonest first. */
export function splitBoard(orders: PackOrder[], today: string) {
  const byDate = (a: PackOrder, b: PackOrder) => a.requested_delivery_date.localeCompare(b.requested_delivery_date) || a.order_number.localeCompare(b.order_number);
  const packing = orders.filter((order) => order.status === "for_preparation").sort(byDate);
  const ready = orders.filter((order) => order.status === "confirmed").sort(byDate);
  return { packing, ready, advanceCount: ready.filter((order) => isAdvanceOrder(order.requested_delivery_date, today)).length };
}

/** The board after a tick, before the server answers (undone if it refuses). */
export function withLinePacked(orders: PackOrder[], lineId: string, packed: boolean): PackOrder[] {
  return orders.map((order) =>
    order.order_items.some((line) => line.id === lineId)
      ? { ...order, order_items: order.order_items.map((line) => (line.id === lineId ? { ...line, preparation_status: packed ? "completed" : "in_progress", note_changed_at: packed ? null : line.note_changed_at } : line)) }
      : order,
  );
}

/**
 * The board with ticks that are saved offline but not sent yet (Phase 10), so
 * a reload or a restart while offline still shows what the packer ticked.
 * Oldest first, so the last tick on a line wins.
 */
export function withQueuedTicks(orders: PackOrder[], queued: readonly { rpc: string; status: string; args: Record<string, unknown> }[]): PackOrder[] {
  return queued
    .filter((item) => item.rpc === "offline_set_item_packed" && (item.status === "pending" || item.status === "syncing"))
    .reduce((board, item) => withLinePacked(board, String(item.args.p_item_id), Boolean(item.args.p_packed)), orders);
}

// ---------------------------------------------------------------------------
// To buy
// ---------------------------------------------------------------------------

export type Horizon = "immediate" | "3days" | "7days" | "custom";
export type DateRange = { from: string; to: string };
/**
 * One line of To buy (MEAH-Prototype 2.html and Figma, 5 Nov): the demand for
 * the range, the stock on hand, and what is left to buy (demand less stock).
 * Read-only: lines are not ticked. `stock` and `short_by` are null when the
 * product's Track inventory switch is off or it has no stock record.
 */
export type BuyItem = {
  product_id: string;
  product_name: string;
  unit: string;
  unit_key: string;
  quantity: number;
  order_count: number;
  /** Always 0: the list is read-only since 5 Nov. Kept for older cached lists. */
  bought: number;
  /** What is left to buy: the demand less the stock on hand. Null when the stock is not tracked or recorded. */
  remaining: number | null;
  stock: number | null;
  short_by: number | null;
  /** False when the product's Track inventory switch is off: no stock is counted. */
  track_stock?: boolean;
};
export type BuyList = { today: string; from: string | null; to: string; overdue_orders: number; items: BuyItem[]; short_lines: number; total_lines: number };

export const HORIZON_DAYS: Record<Exclude<Horizon, "custom">, number> = { immediate: 2, "3days": 3, "7days": 7 };

/**
 * What the server is asked for (prototype windows). Immediate is today and
 * tomorrow, with no start date, so late orders that are still not packed stay
 * on the list. 3 Days and 7 Days start tomorrow ("the next 3 days"). A custom
 * range uses exactly the dates chosen.
 */
export function horizonQuery(horizon: Horizon, today: string, custom: DateRange | null): { from: string | null; to: string } {
  if (horizon === "custom" && custom) return { from: custom.from, to: custom.to };
  if (horizon === "3days" || horizon === "7days") return { from: addDaysIso(today, 1), to: addDaysIso(today, HORIZON_DAYS[horizon]) };
  return { from: null, to: addDaysIso(today, 1) };
}

/** "Needed for Today & Tomorrow (Aug 27 – 28)", "Needed for the next 3 days (Aug 28 – 30)". */
export function horizonLabel(horizon: Horizon, today: string, custom: DateRange | null): string {
  if (horizon === "custom" && custom) {
    const days = daysBetween(custom.from, custom.to) + 1;
    return `Needed ${rangeText(custom.from, custom.to)} (${days} ${days === 1 ? "day" : "days"})`;
  }
  if (horizon === "3days" || horizon === "7days") {
    const range = horizonQuery(horizon, today, null);
    return `Needed for the next ${HORIZON_DAYS[horizon]} days (${rangeText(range.from!, range.to)})`;
  }
  return `Needed for Today & Tomorrow (${rangeText(today, addDaysIso(today, 1))})`;
}

export function formatAmount(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** Figma Buy Row: "2 orders · 60 kg in stock". */
export function buySummary(item: BuyItem): string {
  const orders = `${item.order_count} ${item.order_count === 1 ? "order" : "orders"}`;
  const stock = item.track_stock === false ? "Stock not tracked" : item.stock === null ? `No stock record in ${item.unit}` : `${formatAmount(item.stock)} ${item.unit} in stock`;
  return `${orders} · ${stock}`;
}

/** Figma Buy Row shortfall, in amber: "Buy 3 kg more" when the demand is more than the stock. */
export function shortageText(item: BuyItem): string | null {
  return item.short_by !== null && item.short_by > 0 ? `Buy ${formatAmount(item.short_by)} ${item.unit} more` : null;
}

// ---------------------------------------------------------------------------
// Date range sheet
// ---------------------------------------------------------------------------

export const MAX_RANGE_DAYS = 93;

/** Figma: "Tap start date, then tap end date". A third tap starts again. */
export function pickRangeDay(current: { from: string | null; to: string | null }, day: string, maxDays = MAX_RANGE_DAYS): { from: string | null; to: string | null } {
  if (!current.from || current.to) return { from: day, to: null };
  if (day < current.from) return { from: day, to: null };
  if (daysBetween(current.from, day) + 1 > maxDays) return { from: day, to: null };
  return { from: current.from, to: day };
}

/** Weeks of a month, Sunday first; null for blank cells. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push(new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ---------------------------------------------------------------------------
// PDF (task 5.5)
// ---------------------------------------------------------------------------

/** PDF columns: Product, Orders, [In stock: administrator only], Needed, Bought, Still to buy. */
export function buyListHeaders(): string[] {
  return ["Product", "Orders", "In stock", "Needed", "To buy"];
}

export function buyListRows(list: BuyList): string[][] {
  return list.items.map((item) => [
    item.product_name,
    String(item.order_count),
    item.track_stock === false ? "Not tracked" : item.stock === null ? "No record" : `${formatAmount(item.stock)} ${item.unit}`,
    `${formatAmount(item.quantity)} ${item.unit}`,
    item.remaining === null ? "Stock unknown" : Number(item.remaining) > 0 ? `${formatAmount(item.remaining)} ${item.unit}` : "–",
  ]);
}

/**
 * A "Ready to buy" notification opens To buy on the order's delivery day: the
 * usual Today & Tomorrow list when the order is due by tomorrow (or late),
 * otherwise that one day.
 */
export function focusRange(deliveryDate: string, today: string): { horizon: Horizon; custom: DateRange | null } {
  return daysBetween(today, deliveryDate) <= 1 ? { horizon: "immediate", custom: null } : { horizon: "custom", custom: { from: deliveryDate, to: deliveryDate } };
}
