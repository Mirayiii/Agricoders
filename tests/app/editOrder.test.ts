import assert from "node:assert/strict";
import { test } from "node:test";

import { lineStockMessage, lineStockProblem, lineStockSku } from "../../src/features/orders/editOrderLogic.ts";

const skus = [
  { id: "garlic-kg", product_id: "garlic", unit_of_measurement: "kg", selling_sku: "GAR" },
  { id: "rice-kg", product_id: "rice", unit_of_measurement: "kg", selling_sku: "RIC" },
  { id: "rice-sack", product_id: "rice", unit_of_measurement: "sack", selling_sku: "RIC-S" },
  { id: "lemon-kg", product_id: "lemon", unit_of_measurement: "kg", selling_sku: "LEM" },
];
// Recorded 0 or less only: Lemons (no record) and untracked products are never in here.
const out = new Set(["garlic-kg", "rice-sack"]);
const saved = { product_id: "garlic", product_sku_id: null, unit_of_measurement: "kg", quantity: 2 };
const line = (quantity: string, changes = {}) => ({ product_id: "garlic", product_sku_id: null, unit_of_measurement: "kg", quantity, ...changes });

test("a saved out-of-stock line may keep or lower its quantity", () => {
  assert.equal(lineStockProblem(line("2"), saved, skus, out), null);
  assert.equal(lineStockProblem(line("1.5"), saved, skus, out), null);
});

test("raising a saved out-of-stock line is refused, compared with the saved quantity", () => {
  assert.deepEqual(lineStockProblem(line("3"), saved, skus, out), { kind: "raise", savedQuantity: 2 });
  assert.equal(lineStockMessage({ kind: "raise", savedQuantity: 2 }, "kg "), "Out of stock: keep or lower the quantity (saved: 2 kg), or update the stock first.");
});

test("new lines and changed units are checked as before", () => {
  assert.deepEqual(lineStockProblem(line("1"), undefined, skus, out), { kind: "out" });
  const rice = { product_id: "rice", product_sku_id: null, unit_of_measurement: "kg", quantity: 2 };
  assert.deepEqual(lineStockProblem({ ...rice, quantity: "1", unit_of_measurement: "sack" }, rice, skus, out), { kind: "out" });
  assert.equal(lineStockProblem({ ...rice, quantity: "9" }, rice, skus, out), null, "Rice by the kg is in stock, so it can be raised");
});

test("no stock record, an untracked product or a failed lookup never blocks", () => {
  const lemon = { product_id: "lemon", product_sku_id: null, unit_of_measurement: "kg", quantity: 1 };
  assert.equal(lineStockProblem({ ...lemon, quantity: "9" }, lemon, skus, out), null);
  assert.equal(lineStockProblem({ ...lemon, product_id: "ginger", quantity: "9" }, undefined, skus, out), null);
  assert.equal(lineStockProblem(line("9"), saved, skus, new Set()), null);
});

test("the stock unit is the line's SKU, else the product's selling SKU in that unit", () => {
  assert.equal(lineStockSku({ product_id: "rice", product_sku_id: null, unit_of_measurement: " Sack" }, skus), "rice-sack");
  assert.equal(lineStockSku({ product_id: "rice", product_sku_id: "rice-kg", unit_of_measurement: "sack" }, skus), "rice-kg");
});
