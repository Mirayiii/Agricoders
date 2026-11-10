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
export type PackLine = { id: string; quantity: number; unit_of_measurement: string; notes: string | null; preparation_status: PackStatus; products: { product_name: string } | null };
export type PackOrder = {
  id: string;
  order_number: string;
  requested_delivery_date: string;
  status: "confirmed" | "for_preparation";
  delivery_time_start?: string | null;
  delivery_time_end?: string | null;
  customers: { business_name: string; brand_name?: string | null; delivery_address: string | null } | null;
  order_items: PackLine[];
};

export function packedCount(order: PackOrder): number {
  return order.order_items.filter((line) => line.preparation_status === "completed").length;
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
      ? { ...order, order_items: order.order_items.map((line) => (line.id === lineId ? { ...line, preparation_status: packed ? "completed" : "in_progress" } : line)) }
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
 * One line of the buy list. Requirement PU-01 (Jac, 4 Nov): the quantity
 * marked as bought is saved per product and delivery day, shared by Purchasing
 * and the administrator, so any date range shows the same records. `stock` and
 * `short_by` come back for the administrator only (SI-02, PS-02), and only
 * for products with Track inventory on.
 */
export type BuyItem = {
  product_id: string;
  product_name: string;
  unit: string;
  unit_key: string;
  quantity: number;
  order_count: number;
  bought: number;
  remaining: number;
  stock: number | null;
  short_by: number | null;
  /** False when the product's Track inventory switch is off: no stock is counted. */
  track_stock?: boolean;
};
export type BuyList = { today: string; from: string | null; to: string; overdue_orders: number; items: BuyItem[]; bought_lines: number; total_lines: number };

export const HORIZON_DAYS: Record<Exclude<Horizon, "custom">, number> = { immediate: 2, "3days": 3, "7days": 7 };

/**
 * What the server is asked for. The preset horizons start with no date, so
 * orders that are late and still not packed stay on the list; a custom range
 * uses exactly the dates chosen.
 */
export function horizonQuery(horizon: Horizon, today: string, custom: DateRange | null): { from: string | null; to: string } {
  if (horizon === "custom" && custom) return { from: custom.from, to: custom.to };
  const days = horizon === "custom" ? HORIZON_DAYS.immediate : HORIZON_DAYS[horizon];
  return { from: null, to: addDaysIso(today, days - 1) };
}

/** "Needed for Today & Tomorrow (Aug 27 – 28)". */
export function horizonLabel(horizon: Horizon, today: string, custom: DateRange | null): string {
  if (horizon === "custom" && custom) {
    const days = daysBetween(custom.from, custom.to) + 1;
    return `Needed ${rangeText(custom.from, custom.to)} (${days} ${days === 1 ? "day" : "days"})`;
  }
  const days = horizon === "custom" ? HORIZON_DAYS.immediate : HORIZON_DAYS[horizon];
  const to = addDaysIso(today, days - 1);
  const span = rangeText(today, to);
  return days === 2 ? `Needed for Today & Tomorrow (${span})` : `Needed for the next ${days} days (${span})`;
}

export function formatAmount(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * "2 orders · 60 kg in stock" for the administrator; "2 orders" for Purchasing,
 * who do not monitor warehouse stock (SI-02, PS-02).
 */
export function buySummary(item: BuyItem, showStock: boolean): string {
  const orders = `${item.order_count} ${item.order_count === 1 ? "order" : "orders"}`;
  if (!showStock) return orders;
  const stock = item.track_stock === false ? "Stock not tracked" : item.stock === null ? `No stock record in ${item.unit}` : `${formatAmount(item.stock)} ${item.unit} in stock`;
  return `${orders} · ${stock}`;
}

/** Administrator only: "3 kg short of stock", or null when the stock covers it or none is tracked. */
export function shortageText(item: BuyItem): string | null {
  return item.short_by !== null && item.short_by > 0 ? `${formatAmount(item.short_by)} ${item.unit} short of stock` : null;
}

/** PU-01: a line is bought when the saved bought quantity covers every day in the range. */
export const isBought = (item: Pick<BuyItem, "remaining">) => Number(item.remaining) <= 0;

/** PU-01: "Need 5 kg more" when some was bought but demand has since gone up. */
export function needMoreText(item: Pick<BuyItem, "bought" | "remaining" | "unit">): string | null {
  return Number(item.bought) > 0 && Number(item.remaining) > 0 ? `Need ${formatAmount(item.remaining)} ${item.unit} more` : null;
}

/** The progress bar: "3 of 8 bought" and its share. */
export function buyProgress(list: Pick<BuyList, "bought_lines" | "total_lines">): { done: number; total: number; share: number } {
  const total = Number(list.total_lines) || 0;
  const done = Math.min(Number(list.bought_lines) || 0, total);
  return { done, total, share: total ? done / total : 0 };
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
export function buyListHeaders(showStock: boolean): string[] {
  return ["Product", "Orders", ...(showStock ? ["In stock"] : []), "Needed", "Bought", "Still to buy"];
}

export function buyListRows(list: BuyList, showStock: boolean): string[][] {
  const amount = (value: number, unit: string) => (Number(value) > 0 ? `${formatAmount(value)} ${unit}` : "–");
  return list.items.map((item) => [
    item.product_name,
    String(item.order_count),
    ...(showStock ? [item.track_stock === false ? "Not tracked" : item.stock === null ? "No record" : `${formatAmount(item.stock)} ${item.unit}`] : []),
    `${formatAmount(item.quantity)} ${item.unit}`,
    amount(item.bought, item.unit),
    amount(item.remaining, item.unit),
  ]);
}

/** PU-01: the message on a line whose tick was not saved. */
export function buySaveProblem(online: boolean): string {
  return online ? "Not saved. Tap the line to try again." : "Not saved: you're offline. Ticks need a connection. Tap the line to try again once you're back online.";
}

/**
 * A "Ready to buy" notification opens To buy on the order's delivery day: the
 * usual Today & Tomorrow list when the order is due by tomorrow (or late),
 * otherwise that one day.
 */
export function focusRange(deliveryDate: string, today: string): { horizon: Horizon; custom: DateRange | null } {
  return daysBetween(today, deliveryDate) <= 1 ? { horizon: "immediate", custom: null } : { horizon: "custom", custom: { from: deliveryDate, to: deliveryDate } };
}
