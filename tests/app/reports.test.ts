import assert from "node:assert/strict";
import { test } from "node:test";

import { hasPermission, PERMISSIONS } from "@/constants/permissions";
import {
  chartBars, chartPeriodFor, compact, costNote, customRangeLabel, matchPeriod, parseRange, rangeDays, drLabel, formatPercentOrDash, periodRange, profitLine, rangeLabel, statementCsv, statementHtml, statementText, toCsv, volumeText,
  type Statement, type Totals,
} from "@/features/reports/reportsLogic";

test("reports are for administrators only", () => {
  assert.equal(hasPermission("administrator", PERMISSIONS.viewReports), true);
  assert.equal(hasPermission("administrative_staff", PERMISSIONS.viewReports), false);
  assert.equal(hasPermission("fulfillment_staff", PERMISSIONS.viewReports), false);
  assert.equal(hasPermission("delivery_staff", PERMISSIONS.viewReports), false);
  assert.equal(hasPermission("administrative_staff", PERMISSIONS.managePricing), true, "prototype: administrative staff update prices");
  assert.equal(hasPermission("fulfillment_staff", PERMISSIONS.managePricing), false, "prototype: purchasing has no Pricing tab");
});

test("periods: Sunday-to-Saturday weeks, months, quarters and years, and earlier ones", () => {
  assert.deepEqual(periodRange("week", "2026-08-27"), { start: "2026-08-23", end: "2026-08-29" });
  assert.equal(rangeLabel("week", periodRange("week", "2026-08-27")), "Aug 23 – 29");
  assert.equal(rangeLabel("week", periodRange("week", "2026-09-01")), "Aug 30 – Sep 5");
  assert.deepEqual(periodRange("week", "2026-08-27", 1), { start: "2026-08-16", end: "2026-08-22" });
  assert.deepEqual(periodRange("month", "2026-02-10"), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(periodRange("month", "2026-01-10", 1), { start: "2025-12-01", end: "2025-12-31" });
  assert.deepEqual(periodRange("quarter", "2026-08-27"), { start: "2026-07-01", end: "2026-09-30" });
  assert.equal(rangeLabel("quarter", periodRange("quarter", "2026-08-27")), "Jul – Sep 2026");
  assert.deepEqual(periodRange("year", "2026-08-27", 1), { start: "2025-01-01", end: "2025-12-31" });
  assert.deepEqual(periodRange("today", "2026-08-27"), { start: "2026-08-27", end: "2026-08-27" });
});

test("chart bars: days for a week, weeks for a quarter, months for a year, running total for Trend", () => {
  const week = ["23", "24", "25", "26", "27", "28", "29"].map((d, i) => ({ date: `2026-08-${d}`, sales: i * 100, volume: i }));
  const bars = chartBars("week", week, "sales");
  assert.deepEqual(bars.map((b) => b.label), ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  assert.equal(bars[6].value, 600);
  assert.deepEqual(chartBars("week", week, "volume", "trend").map((b) => b.value), [0, 1, 3, 6, 10, 15, 21]);
  const quarter = Array.from({ length: 14 }, (_, i) => ({ date: `2026-07-${String(i + 1).padStart(2, "0")}`, sales: 10 }));
  assert.deepEqual(chartBars("quarter", quarter, "sales").map((b) => [b.label, b.value]), [["W1", 70], ["W2", 70]]);
  const year = [{ date: "2026-01-05", sales: 5 }, { date: "2026-01-20", sales: 5 }, { date: "2026-02-01", sales: 1 }];
  assert.deepEqual(chartBars("year", year, "sales").map((b) => [b.label, b.value]), [["Jan", 10], ["Feb", 1]]);
  assert.equal(compact(12500), "12.5k");
  assert.equal(compact(425), "425");
});

const totals = (extra: Partial<Totals>): Totals => ({ sales: 0, orders: 0, covered_sales: 0, cost: 0, profit: 0, margin_percent: null, lines_without_cost: 0, volume: [], ...extra });

test("totals text: margin blank and explained when costs are missing", () => {
  const money = (v: number) => `₱${v.toFixed(2)}`;
  assert.equal(profitLine(totals({ margin_percent: 24.2, profit: 8387 }), money), "Profit: +₱8387.00");
  assert.equal(profitLine(totals({ margin_percent: -3, profit: -12 }), money), "Profit: −₱12.00");
  assert.equal(profitLine(totals({ lines_without_cost: 2 }), money), "No costs recorded");
  assert.equal(formatPercentOrDash(null), "—");
  assert.match(costNote(totals({ lines_without_cost: 1 })) ?? "", /^1 line has no cost recorded/);
  assert.equal(costNote(totals({})), null);
  assert.equal(volumeText([{ unit: "kg", quantity: 12.5 }, { unit: "pc", quantity: 12 }]), "12.5 kg · 12 pc");
  assert.equal(volumeText([]), "0 kg");
});

test("CSV escapes commas, quotes and spreadsheet formulas", () => {
  assert.equal(toCsv(["a", "b"], [["Casa Verde, Inc.", 'say "hi"'], ["=HYPERLINK()", -5]]), 'a,b\n"Casa Verde, Inc.","say ""hi"""\n\'=HYPERLINK(),-5');
});

const statement: Statement = {
  customer: { id: "c", name: "Casa Verde <Restaurant>", business_name: "Casa Verde Holdings Inc.", brand_name: "Casa Verde <Restaurant>", tin: "012-345-678-000", code: "CUS-0012", contact_person: null, phone: null, delivery_address: "12 Mabini St." },
  start: "2026-08-01", end: "2026-08-31",
  totals: totals({ sales: 1140, orders: 2 }), daily: [],
  orders: [
    { order_id: "o1", order_number: "ORD-1049", status: "confirmed", delivery_date: "2026-08-29", dr_number: 49, sales_invoice_number: null, received_by: null, subtotal: 1100, discount: 110, total: 990,
      lines: [{ product_name: "Red onions", quantity: 10, unit: "kg", unit_price: 100, amount: 1000 }, { product_name: "Tomatoes", quantity: 2, unit: "kg", unit_price: 50, amount: 100 }] },
    { order_id: "o2", order_number: "ORD-1050", status: "for_verification", delivery_date: "2026-08-30", dr_number: null, sales_invoice_number: null, received_by: null, subtotal: 150, discount: 0, total: 150,
      lines: [{ product_name: "Eggs", quantity: 1, unit: "dozen", unit_price: 150, amount: 150 }] },
  ],
};

test("customer statement: itemized orders with discounts, brand and TIN, escaped", () => {
  assert.equal(drLabel(49), "DR-0049");
  assert.equal(drLabel(null), null);
  const html = statementHtml(statement, "MEAH", "Aug 31");
  assert.match(html, /Casa Verde &lt;Restaurant&gt;/);
  assert.doesNotMatch(html, /<Restaurant>/);
  assert.match(html, /Business name: Casa Verde Holdings Inc\./);
  assert.match(html, /TIN#: 012-345-678-000/);
  assert.match(html, /DR-0049/);
  assert.match(html, /Discount<\/td><td class="num">−₱110\.00/);
  assert.match(html, /Total billed: ₱1,140\.00/);
  const csv = statementCsv(statement).split("\n");
  assert.equal(csv[0], "Delivery date,Order,DR,Status,Product,Quantity,Unit,Unit price,Amount");
  assert.equal(csv.length, 5);
  assert.equal(csv[3], "2026-08-29,ORD-1049,DR-0049,Discount,,,,,-110.00");
});

test("Viber/SMS statement: proof of billing text with no withholding (Jac, 8 Nov)", () => {
  const lines = statementText(statement, "Meah Trading").split("\n");
  assert.equal(lines[0], "MEAH TRADING — PROOF OF BILLING");
  assert.equal(lines[1], "Customer: Casa Verde <Restaurant>");
  assert.equal(lines[2], "Billing Period: Aug 1, 2026 – Aug 31, 2026");
  assert.equal(lines[4], "Total Amount Due: ₱1,140.00");
  assert.ok(lines.includes("Aug 29, 2026 (DR-0049) - ₱990.00 [Confirmed]"));
  assert.ok(lines.includes("  • Red onions (10 kg): ₱1,000.00"));
  assert.ok(lines.includes("  • Discount: −₱110.00"));
  assert.ok(lines.includes("Aug 30, 2026 (ORD-1050) - ₱150.00 [For verification]"));
  assert.equal(lines.at(-1), "Exact amount to collect: ₱1,140.00. Thank you!");
  const text = lines.join("\n");
  assert.doesNotMatch(text, /withholding|2307|CWT/i);
  assert.match(statementText({ ...statement, orders: [] }, "MEAH"), /DELIVERIES BREAKDOWN:\nNo orders in this period\./);
});

test("picked date ranges: labels, matching tabs, chart grouping and route params", () => {
  assert.equal(customRangeLabel({ start: "2026-11-19", end: "2026-11-25" }), "Nov 19 – 25, 2026");
  assert.equal(customRangeLabel({ start: "2026-11-19", end: "2026-12-02" }), "Nov 19 – Dec 2, 2026");
  assert.equal(customRangeLabel({ start: "2026-12-28", end: "2027-01-03" }), "Dec 28, 2026 – Jan 3, 2027");
  assert.equal(customRangeLabel({ start: "2026-11-19", end: "2026-11-19" }), "Nov 19, 2026");
  assert.equal(rangeDays({ start: "2026-11-19", end: "2026-11-25" }), 7);

  const periods = ["week", "month", "quarter", "year"] as const;
  assert.deepEqual(matchPeriod({ start: "2026-11-01", end: "2026-11-07" }, "2026-11-05", [...periods]), { period: "week", back: 0 });
  assert.deepEqual(matchPeriod({ start: "2026-10-01", end: "2026-10-31" }, "2026-11-05", [...periods]), { period: "month", back: 1 });
  assert.deepEqual(matchPeriod({ start: "2026-01-01", end: "2026-12-31" }, "2026-11-05", [...periods]), { period: "year", back: 0 });
  assert.equal(matchPeriod({ start: "2026-11-19", end: "2026-11-25" }, "2026-11-05", [...periods]), null, "a future or uneven range lights no tab");

  assert.equal(chartPeriodFor({ start: "2026-11-19", end: "2026-11-25" }), "week");
  assert.equal(chartPeriodFor({ start: "2026-11-01", end: "2026-11-20" }), "month");
  assert.equal(chartPeriodFor({ start: "2026-09-01", end: "2026-11-20" }), "quarter");
  assert.equal(chartPeriodFor({ start: "2026-01-01", end: "2026-11-20" }), "year");

  assert.deepEqual(parseRange("2026-11-19", "2026-11-25"), { start: "2026-11-19", end: "2026-11-25" });
  assert.equal(parseRange("2026-11-25", "2026-11-19"), null);
  assert.equal(parseRange("2026-02-30", "2026-03-02"), null);
  assert.equal(parseRange("2025-01-01", "2026-06-01"), null, "longer than the picker allows");
  assert.equal(parseRange(undefined, undefined), null);
});
