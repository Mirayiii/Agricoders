import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EMPTY_PRODUCT, batchEditsFrom, batchRows, changeVsLast, filterCounts, filterProducts, marginAmount, marginPercent, marginPreview,
  marginTone, parsePrice, priceProblem, productDetailLine, productPayload, productProblem, stockAfter, stockLevel, toggleUnit,
  type BatchSheetRow, type ProductOverview,
} from "@/features/products/productsLogic";
import { calculateMargin } from "@/types/business";

const product = (extra: Partial<ProductOverview>): ProductOverview => ({
  id: "p", product_name: "Red onions", status: "active", unit: "kg", track_stock: false, unit_count: 1, buying_sku: null, selling_sku: null, sku_id: "s",
  cost_price: null, selling_price: null, margin_percent: null, stock_quantity: null, low_stock_threshold: null, stock_status: null, ...extra,
});

test("margin is on the selling price, as in Figma (₱140 vs ₱105 = 25%)", () => {
  assert.equal(marginPercent(105, 140), 25);
  assert.equal(marginAmount(105, 140), 35);
  assert.equal(marginPercent(110, 145), 24.1);
  assert.equal(calculateMargin(105, 140).marginPercentage, 25);
});

test("missing cost and zero selling price give no margin instead of 100% or a division by zero", () => {
  assert.equal(marginPercent(0, 140), null);
  assert.equal(marginPercent(null, 140), null);
  assert.equal(marginPercent(50, 0), null);
  assert.equal(marginAmount(0, 140), null);
  assert.equal(calculateMargin(0, 140).marginPercentage, null);
  assert.deepEqual(marginPreview("0", "140"), { text: "No cost recorded · margin not shown", tone: "neutral" });
  assert.equal(marginPreview("50", "0"), null);
});

test("selling at a loss shows a negative margin in red", () => {
  assert.equal(marginPercent(150, 140), -7.1);
  assert.equal(marginTone(-7.1), "danger");
  assert.equal(marginTone(15), "pending");
  assert.equal(marginTone(25), "success");
  assert.equal(marginPreview("150", "140")?.text, "Margin −₱10.00 · -7.1%");
});

test("price forms check the same rules as the server", () => {
  assert.equal(parsePrice("₱1,450.50"), 1450.5);
  assert.ok(Number.isNaN(parsePrice("12.345") as number));
  assert.equal(priceProblem("", "140"), "Enter both the cost and the selling price");
  assert.equal(priceProblem("100", "0"), "The selling price must be more than ₱0");
  assert.equal(priceProblem("0", "140"), null);
  assert.equal(priceProblem("", "", { optional: true }), null);
});

test("Add product: units, default unit and payload", () => {
  let draft = toggleUnit(EMPTY_PRODUCT, "piece");
  assert.deepEqual(draft.units, ["kg", "piece"]);
  assert.equal(draft.default_unit, "kg");
  draft = toggleUnit(draft, "kg");
  assert.equal(draft.default_unit, "piece", "removing the default moves it to the next unit");
  draft = toggleUnit(draft, "piece");
  assert.equal(productProblem({ ...draft, product_name: "Bell peppers" }), "Choose at least one unit the product is sold by");
  const ready = { ...toggleUnit(draft, " sack  (25kg) "), product_name: "  Bell   peppers ", selling_price: "80" };
  assert.equal(productProblem(ready), "Enter both the cost and the selling price");
  assert.deepEqual(productPayload({ ...ready, cost_price: "60" }), {
    product_name: "Bell peppers", units: ["sack (25kg)"], default_unit: "sack (25kg)", track_stock: false, cost_price: 60, selling_price: 80, buying_sku: null, selling_sku: null,
  });
  assert.equal("cost_price" in productPayload({ ...ready, selling_price: "" }), false, "no price yet is allowed");
});

test("product list: All and Stocked show active products; search covers SKU codes", () => {
  const rows = [
    product({ id: "a", product_name: "Tomatoes", selling_sku: "100001" }),
    product({ id: "b", product_name: "Red onions", track_stock: true, selling_sku: "101002" }),
    product({ id: "c", product_name: "Okra", status: "archived" }),
  ];
  assert.deepEqual(filterProducts(rows, "all", "").map((r) => r.id), ["a", "b"]);
  assert.deepEqual(filterProducts(rows, "stocked", "").map((r) => r.id), ["b"]);
  assert.deepEqual(filterProducts(rows, "archived", "").map((r) => r.id), ["c"]);
  assert.deepEqual(filterProducts(rows, "all", "1010").map((r) => r.id), ["b"]);
  assert.deepEqual(filterCounts(rows), { all: 2, stocked: 1, low: 0, out: 0, archived: 1 });
  assert.equal(productDetailLine(rows[0]), "100001 · per kg");
  assert.equal(productDetailLine(product({ unit: "head" })), "per head");
});

test("stock bar and manual stock changes", () => {
  assert.equal(stockLevel(0, 20), 0);
  assert.equal(stockLevel(18, 20), 0.3);
  assert.equal(stockLevel(100, 20), 1);
  assert.deepEqual(stockAfter(18, "increase", "5"), { after: 23, problem: null });
  assert.deepEqual(stockAfter(18, "decrease", "20"), { after: 18, problem: "Only 18 in stock. Remove 18 or less." });
  assert.deepEqual(stockAfter(1.5, "decrease", "0.25"), { after: 1.25, problem: null });
});

test("batch update sends only changed rows, and one bad row stops the batch", () => {
  const rows: BatchSheetRow[] = [
    { product_id: "t", name: "Tomatoes", unit: "kg", sku: "100001", cost_price: 62, selling_price: 85, last_cost: 62, last_selling: 85 },
    { product_id: "c", name: "Cabbage", unit: "head", sku: "100003", cost_price: 80, selling_price: 95, last_cost: 80, last_selling: 95 },
    { product_id: "h", name: "Honey", unit: "bottle", sku: null, cost_price: null, selling_price: null, last_cost: null, last_selling: null },
  ];
  const edits = batchEditsFrom(rows);
  assert.deepEqual(batchRows(rows, edits), { rows: [], problem: null });
  edits.c = { cost: "60", selling: "60" };
  assert.deepEqual(batchRows(rows, edits).rows, [{ product_id: "c", cost_price: 60, selling_price: 60 }]);
  assert.deepEqual(changeVsLast(rows[1], edits.c), { text: "−₱35.00 vs last", direction: "down" });
  assert.deepEqual(changeVsLast(rows[0], edits.t), { text: "No change", direction: "same" });
  assert.equal(changeVsLast(rows[2], edits.h).direction, "new");
  edits.h = { cost: "200", selling: "0" };
  assert.deepEqual(batchRows(rows, edits), { rows: [], problem: "Honey: the selling price must be more than ₱0" });
});

test("product list: Low stock and Out of stock filters (requirement PS-02)", () => {
  const rows = [
    product({ id: "ok", track_stock: true, stock_status: "available" }),
    product({ id: "low", track_stock: true, stock_status: "low_stock" }),
    product({ id: "out", track_stock: true, stock_status: "out_of_stock" }),
    product({ id: "untracked", track_stock: false, stock_status: "out_of_stock" }),
    product({ id: "gone", status: "archived", track_stock: true, stock_status: "out_of_stock" }),
  ];
  assert.deepEqual(filterProducts(rows, "low", "").map((r) => r.id), ["low"]);
  assert.deepEqual(filterProducts(rows, "out", "").map((r) => r.id), ["out"], "untracked and archived products are left out");
  assert.deepEqual(filterCounts(rows), { all: 4, stocked: 3, low: 1, out: 1, archived: 1 });
});

test("missing stock is not zero (Jac, 8 Nov afternoon)", async () => {
  const { stockUnknown, STOCK_UNAVAILABLE } = await import("@/features/products/productsLogic");
  assert.equal(stockUnknown(product({ track_stock: true, stock_quantity: null })), true, "tracked with no record: unknown");
  assert.equal(stockUnknown(product({ track_stock: true, stock_quantity: 0 })), false, "a recorded 0 is known");
  assert.equal(stockUnknown(product({ track_stock: false, stock_quantity: null })), false, "untracked is not 'unavailable'");
  assert.equal(STOCK_UNAVAILABLE.label, "Stock unavailable");
});
