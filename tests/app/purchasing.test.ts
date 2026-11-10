import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addDaysIso,
  buyListHeaders,
  buyListRows,
  buyProgress,
  buySummary,
  isBought,
  needMoreText,
  buySaveProblem,
  focusRange,
  deliveryDay,
  horizonLabel,
  horizonQuery,
  isAdvanceOrder,
  manilaToday,
  monthGrid,
  pickRangeDay,
  rangeText,
  shortageText,
  splitBoard,
  withLinePacked,
  type BuyItem,
  type PackOrder,
} from "@/features/purchasing/purchasingLogic";

test("Manila's date, whatever the phone's time zone", () => {
  // 17:30 UTC on 26 Aug is 01:30 on 27 Aug in Manila.
  assert.equal(manilaToday(new Date("2026-08-26T17:30:00Z")), "2026-08-27");
  assert.equal(manilaToday(new Date("2026-08-26T15:59:00Z")), "2026-08-26");
});

test("advance orders are due after tomorrow (Manila dates)", () => {
  const today = "2026-08-27";
  assert.equal(isAdvanceOrder("2026-08-27", today), false);
  assert.equal(isAdvanceOrder("2026-08-28", today), false);
  assert.equal(isAdvanceOrder("2026-08-29", today), true);
  assert.equal(isAdvanceOrder("2026-08-25", today), false, "a late order is not an advance order");
  assert.equal(isAdvanceOrder("2026-09-01", "2026-08-31"), false, "tomorrow across a month end");
  assert.equal(isAdvanceOrder("2027-01-02", "2026-12-31"), true, "across a year end");
});

test("delivery day labels", () => {
  assert.equal(deliveryDay("2026-08-27", "2026-08-27"), "Today");
  assert.equal(deliveryDay("2026-08-28", "2026-08-27"), "Tomorrow");
  assert.equal(deliveryDay("2026-08-26", "2026-08-27"), "Yesterday");
  assert.equal(deliveryDay("2026-08-30", "2026-08-27"), "Sun, 30 Aug");
});

const order = (id: string, status: PackOrder["status"], date: string, lines: PackOrder["order_items"] = []): PackOrder => ({
  id, order_number: id, status, requested_delivery_date: date, customers: null, order_items: lines,
});
const line = (id: string, done = false): PackOrder["order_items"][number] => ({ id, quantity: 1, unit_of_measurement: "kg", notes: null, preparation_status: done ? "completed" : "pending", products: null });

test("the board splits Packing now and Ready to start, soonest first, and counts advance orders", () => {
  const board = splitBoard([
    order("B", "confirmed", "2026-08-30"),
    order("A", "for_preparation", "2026-08-27"),
    order("C", "confirmed", "2026-08-28"),
    order("D", "confirmed", "2026-09-02"),
  ], "2026-08-27");
  assert.deepEqual(board.packing.map((o) => o.id), ["A"]);
  assert.deepEqual(board.ready.map((o) => o.id), ["C", "B", "D"]);
  assert.equal(board.advanceCount, 2);
});

test("a tick shows straight away on the right line only", () => {
  const before = [order("A", "for_preparation", "2026-08-27", [line("1"), line("2", true)])];
  const after = withLinePacked(before, "1", true);
  assert.deepEqual(after[0].order_items.map((l) => l.preparation_status), ["completed", "completed"]);
  assert.deepEqual(withLinePacked(after, "2", false)[0].order_items.map((l) => l.preparation_status), ["completed", "in_progress"]);
  assert.equal(before[0].order_items[0].preparation_status, "pending", "the cached board is not changed in place");
});

test("horizons: presets keep late orders, custom uses the chosen dates", () => {
  const today = "2026-08-27";
  assert.deepEqual(horizonQuery("immediate", today, null), { from: null, to: "2026-08-28" });
  assert.deepEqual(horizonQuery("3days", today, null), { from: null, to: "2026-08-29" });
  assert.deepEqual(horizonQuery("7days", today, null), { from: null, to: "2026-09-02" });
  assert.deepEqual(horizonQuery("custom", today, { from: "2026-08-23", to: "2026-08-28" }), { from: "2026-08-23", to: "2026-08-28" });
  assert.equal(horizonLabel("immediate", today, null), "Needed for Today & Tomorrow (Aug 27 – 28)");
  assert.equal(horizonLabel("7days", today, null), "Needed for the next 7 days (Aug 27 – Sep 2)");
  assert.equal(horizonLabel("custom", today, { from: "2026-08-23", to: "2026-08-28" }), "Needed Aug 23 – 28 (6 days)");
  assert.equal(rangeText("2026-08-27", "2026-08-27"), "Aug 27");
});

test("date range: tap start, then end; a third tap starts again", () => {
  let range = pickRangeDay({ from: null, to: null }, "2026-08-23");
  assert.deepEqual(range, { from: "2026-08-23", to: null });
  range = pickRangeDay(range, "2026-08-28");
  assert.deepEqual(range, { from: "2026-08-23", to: "2026-08-28" });
  assert.deepEqual(pickRangeDay(range, "2026-08-10"), { from: "2026-08-10", to: null });
  assert.deepEqual(pickRangeDay({ from: "2026-08-23", to: null }, "2026-08-20"), { from: "2026-08-20", to: null }, "an earlier day becomes the new start");
  assert.deepEqual(pickRangeDay({ from: "2026-08-23", to: null }, "2026-08-23"), { from: "2026-08-23", to: "2026-08-23" }, "one day is a range");
  assert.deepEqual(pickRangeDay({ from: "2026-01-01", to: null }, addDaysIso("2026-01-01", 93)), { from: addDaysIso("2026-01-01", 93), to: null }, "longer than 93 days starts again");
});

test("August 2026 starts on a Saturday, as in Figma", () => {
  const weeks = monthGrid(2026, 7);
  assert.equal(weeks[0].filter(Boolean).length, 1);
  assert.equal(weeks[0][6], "2026-08-01");
  assert.equal(weeks[4][0], "2026-08-23");
  assert.equal(weeks[5][1], "2026-08-31");
});

const buy = (extra: Partial<BuyItem>): BuyItem => ({ product_id: "p", product_name: "Red onions", unit: "kg", unit_key: "kg", quantity: 21, order_count: 2, bought: 0, remaining: 21, stock: 18, short_by: 3, ...extra });
const list = (items: BuyItem[]) => ({ today: "", from: null, to: "", overdue_orders: 0, items, bought_lines: items.filter(isBought).length, total_lines: items.length });

test("buy rows: stock for the administrator only (SI-02, PS-02)", () => {
  assert.equal(buySummary(buy({}), true), "2 orders · 18 kg in stock");
  assert.equal(buySummary(buy({ stock: null, short_by: null }), false), "2 orders", "Purchasing sees demand, not warehouse stock");
  assert.equal(shortageText(buy({})), "3 kg short of stock");
  assert.equal(shortageText(buy({ stock: 60, short_by: 0 })), null);
  assert.equal(buySummary(buy({ order_count: 1, stock: null, short_by: null }), true), "1 order · No stock record in kg");
  assert.equal(shortageText(buy({ stock: null, short_by: null })), null);
  assert.equal(buySummary(buy({ stock: null, short_by: null, track_stock: false }), true), "2 orders · Stock not tracked", "Track inventory off: no stock figure");
  assert.deepEqual(buyListRows(list([buy({ stock: null, short_by: null, track_stock: false })]), true)[0][2], "Not tracked");
  assert.deepEqual(buyListHeaders(false), ["Product", "Orders", "Needed", "Bought", "Still to buy"]);
  assert.deepEqual(buyListHeaders(true), ["Product", "Orders", "In stock", "Needed", "Bought", "Still to buy"]);
  assert.deepEqual(buyListRows(list([buy({ bought: 16, remaining: 5 }), buy({ product_name: "Calamansi", stock: null, short_by: null, quantity: 6, remaining: 6 })]), true), [
    ["Red onions", "2", "18 kg", "21 kg", "16 kg", "5 kg"],
    ["Calamansi", "2", "No record", "6 kg", "–", "6 kg"],
  ]);
  assert.deepEqual(buyListRows(list([buy({ stock: null, short_by: null, bought: 21, remaining: 0 })]), false), [["Red onions", "2", "21 kg", "21 kg", "–"]]);
});

test("PU-01: bought 45 kg, demand rises to 50 kg, tick again", () => {
  const before = buy({ quantity: 50, bought: 45, remaining: 5 });
  assert.equal(isBought(before), false);
  assert.equal(needMoreText(before), "Need 5 kg more");
  assert.equal(needMoreText(buy({ bought: 0, remaining: 21 })), null, "nothing bought yet: no 'more' message");
  assert.equal(needMoreText(buy({ bought: 21, remaining: 0 })), null);
  // After ticking again the server reads back 50 kg bought (tested in phase11 SQL).
  const after = list([buy({ quantity: 50, bought: 50, remaining: 0 }), buy({ product_id: "q", product_name: "Garlic" })]);
  assert.equal(isBought(after.items[0]), true);
  assert.deepEqual(buyProgress(after), { done: 1, total: 2, share: 0.5 });
  assert.deepEqual(buyProgress({ bought_lines: 0, total_lines: 0 }), { done: 0, total: 0, share: 0 });
});

test("PU-01: online-only ticks explain how to retry", () => {
  assert.match(buySaveProblem(true), /Not saved\. Tap the line to try again/);
  assert.match(buySaveProblem(false), /offline.*need a connection/);
});

test("AS-02: Ready to buy opens To buy on the order's delivery day", () => {
  assert.deepEqual(focusRange("2026-11-05", "2026-11-04"), { horizon: "immediate", custom: null });
  assert.deepEqual(focusRange("2026-11-03", "2026-11-04"), { horizon: "immediate", custom: null }, "a late order is on the default list");
  assert.deepEqual(focusRange("2026-11-09", "2026-11-04"), { horizon: "custom", custom: { from: "2026-11-09", to: "2026-11-09" } });
});
