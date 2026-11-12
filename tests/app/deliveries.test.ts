import assert from "node:assert/strict";
import { test } from "node:test";

import {
  stopIsRepacking,
  buildRoutes,
  deliveredLabel,
  driverStopsText,
  moveStop,
  overlappingStops,
  peso,
  receiptDate,
  receiptHtml,
  receiptFileName,
  VOID_LABEL,
  roundingNote,
  ROUNDING_NOTE,
  splitTabs,
  stopTimeText,
  upcomingLabel,
  type Receipt,
  type StopRow,
} from "@/features/deliveries/deliveriesLogic";

const stop = (id: string, extra: Partial<StopRow> = {}, order: Partial<NonNullable<StopRow["orders"]>> = {}): StopRow => ({
  id, order_id: `o-${id}`, scheduled_date: "2026-08-27", scheduled_time: null, status: "scheduled", route_position: null,
  received_by: null, completed_at: null, assigned_driver_id: null, profiles: null,
  orders: { order_number: `ORD-${id}`, delivery_time_start: null, delivery_time_end: null, customers: null, order_items: [{ id: "i" }], ...order },
  ...extra,
});

test("delivery time: the delivery's time first, then the order's; else Not specified", () => {
  assert.equal(stopTimeText(stop("a", { scheduled_time: "10:30:00" })), "10:30 AM");
  assert.equal(stopTimeText(stop("a", {}, { delivery_time_start: "07:00:00", delivery_time_end: "09:00:00" })), "7:00 AM – 9:00 AM");
  assert.equal(stopTimeText(stop("a", {}, { delivery_time_start: "13:00:00" })), "1:00 PM");
  assert.equal(stopTimeText(stop("a")), "Not specified");
});

test("overlaps: same time, or windows that share time; missing times are left out", () => {
  const same = overlappingStops([stop("a", { scheduled_time: "10:30" }), stop("b", { scheduled_time: "10:30" })]);
  assert.deepEqual([...same].sort(), ["a", "b"], "Figma: two stops at 10:30 AM");
  const windows = overlappingStops([
    stop("a", {}, { delivery_time_start: "07:00", delivery_time_end: "09:00" }),
    stop("b", { scheduled_time: "08:30" }),
    stop("c", {}, { delivery_time_start: "09:00", delivery_time_end: "10:00" }),
    stop("d"),
    stop("e"),
  ]);
  assert.deepEqual([...windows].sort(), ["a", "b"], "8:30 is inside 7–9; 9:00 starts as 7–9 ends; no-time stops never overlap");
});

test("routes: one per driver, unassigned first, in saved order then time", () => {
  const routes = buildRoutes([
    stop("r2", { assigned_driver_id: "rico", route_position: 2, profiles: { full_name: "Rico Bautista", email: "" } }),
    stop("r1", { assigned_driver_id: "rico", route_position: 1, profiles: { full_name: "Rico Bautista", email: "" } }),
    stop("u2", { scheduled_time: "11:00" }),
    stop("u1", { scheduled_time: "09:00" }),
    stop("done", { status: "completed" }),
  ]);
  assert.deepEqual(routes.map((r) => r.driverName), ["Unassigned", "Rico Bautista"]);
  assert.deepEqual(routes[0].stops.map((s) => s.id), ["u1", "u2"]);
  assert.deepEqual(routes[1].stops.map((s) => s.id), ["r1", "r2"]);
});

test("moving stops", () => {
  assert.deepEqual(moveStop(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveStop(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
  assert.deepEqual(moveStop(["a", "b"], 0, -1), ["a", "b"], "the first stop cannot move up");
});

test("tabs: Today includes late open stops; Upcoming later days; Done newest first", () => {
  const tabs = splitTabs([
    stop("late", { scheduled_date: "2026-08-26" }),
    stop("today"),
    stop("tomorrow", { scheduled_date: "2026-08-28" }),
    stop("old", { status: "completed", completed_at: "2026-08-25T01:00:00Z" }),
    stop("new", { status: "completed", completed_at: "2026-08-26T01:15:00Z" }),
    stop("cancelled", { status: "cancelled" }),
  ], "2026-08-27");
  assert.deepEqual(tabs.today.map((s) => s.id), ["late", "today"]);
  assert.deepEqual(tabs.upcoming.map((s) => s.id), ["tomorrow"]);
  assert.deepEqual(tabs.done.map((s) => s.id), ["new", "old"]);
});

test("labels in Manila time", () => {
  assert.equal(deliveredLabel("2026-08-26T01:15:00Z", "2026-08-27"), "Yesterday · 9:15 AM");
  assert.equal(deliveredLabel("2026-08-25T06:30:00Z", "2026-08-27"), "Tue, 25 Aug · 2:30 PM");
  assert.equal(upcomingLabel(stop("a", { scheduled_date: "2026-08-28", scheduled_time: "07:00" }), "2026-08-27"), "Tomorrow · 7:00 AM");
  assert.equal(upcomingLabel(stop("a", { scheduled_date: "2026-08-28" }), "2026-08-27"), "Tomorrow · Not specified");
  assert.equal(driverStopsText(0), "Available");
  assert.equal(driverStopsText(1), "1 stop today");
  assert.equal(driverStopsText(2), "2 stops today");
});

const receipt: Receipt = {
  receipt_id: "r", order_id: "o", dr_number: 7, dr_label: "DR-0007", issued_at: "2026-10-13T17:00:00Z", layout: "letter",
  company_name: "MEAH AGRICULTURAL PRODUCTS TRADING", company_address: "162 F. Benitez St.", company_phone: "0966-168-1602",
  order_number: "ORD-1043", customer_name: "Negril <Trading> Inc.", delivery_address: "554 Altura St.", delivery_date: "2026-10-14",
  sales_invoice_number: "SI-1", issued_by_name: "Juan Sebastian Hizon",
  lines: [{ quantity: 12, unit: "head", description: "Cabbage", unit_price: 110, amount: 1320 }],
  subtotal: 1320, discount_amount: 0, total: 1320,
};

test("receipt: Letter layout, saved contents only, text escaped", () => {
  assert.equal(peso(4298), "₱4,298.00");
  assert.equal(peso(1234567.5), "₱1,234,567.50");
  assert.equal(receiptDate("2026-10-14"), "10/14/26");
  assert.equal(receiptDate("2026-10-13T17:00:00Z"), "10/14/26", "issued after 1 AM Manila on the 14th");
  const html = receiptHtml(receipt);
  assert.match(html, /size: letter/);
  assert.match(html, /DR NO:<\/span> 0007/);
  assert.match(html, /12\.00 head/);
  assert.match(html, /TOTAL SALES:<\/td><td class="c">₱1,320\.00/);
  assert.match(html, /Negril &lt;Trading&gt; Inc\./);
  assert.doesNotMatch(html, /LESS DISCOUNT/);
  assert.match(receiptHtml({ ...receipt, discount_amount: 20, total: 1300 }), /LESS DISCOUNT:<\/td><td class="c">-₱20\.00/);
});

test("receipt: rounding note only when line amounts don't add up to the old total", () => {
  assert.equal(roundingNote(receipt), null);
  assert.doesNotMatch(receiptHtml(receipt), /originally recorded/);
  // An order from before the rollout: 3 × 33.335 = 100.005 kept as 100.01, lines rounded to 33.34 each = 100.02.
  const old: Receipt = { ...receipt, lines: [1, 2, 3].map((n) => ({ quantity: 1, unit: "kg", description: `Item ${n}`, unit_price: 33.335, amount: 33.34 })), subtotal: 100.01, total: 100.01 };
  assert.equal(roundingNote(old), ROUNDING_NOTE);
  assert.match(receiptHtml(old), /Total as originally recorded; line amounts are rounded\./);
  assert.match(receiptHtml(old), /TOTAL SALES:<\/td><td class="c">₱100\.01/, "the old total is unchanged");
  // A discount doesn't trigger it: lines are compared with the subtotal.
  assert.equal(roundingNote({ ...receipt, discount_amount: 20, total: 1300 } as Receipt), null);
});

test("DE-03: a cancelled order's receipt says VOID on every download", () => {
  const voided = { ...receipt, voided_at: "2026-11-04T09:00:00Z" };
  assert.equal(VOID_LABEL, "VOID — Order cancelled");
  const html = receiptHtml(voided);
  assert.match(html, /VOID — Order cancelled/);
  assert.match(html, />VOID</, "a large VOID mark across the page");
  assert.ok(html.includes("DR NO:</span> 0007"), "same DR number");
  assert.match(receiptFileName(voided), / VOID$/);
  assert.doesNotMatch(receiptHtml(receipt), /VOID/, "a valid receipt has no VOID mark");
});

test("a stop whose order is back in Packing can't be marked delivered", () => {
  assert.equal(stopIsRepacking({ status: "scheduled", orders: { status: "for_preparation" } }), true);
  assert.equal(stopIsRepacking({ status: "scheduled", orders: { status: "for_delivery" } }), false);
  assert.equal(stopIsRepacking({ status: "completed", orders: { status: "completed" } }), false);
  assert.equal(stopIsRepacking({ status: "scheduled", orders: null }), false);
});
