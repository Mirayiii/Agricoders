import assert from "node:assert/strict";
import { test } from "node:test";


import {
  buildCatalog,
  buildPayload,
  cleanQuantityInput,
  deliveryTimeProblem,
  deliveryTimeText,
  estimate,
  fromTime,
  lineCents,
  priceLines,
  priceProblem,
  stepQuantity,
  stockTag,
  stockWarning,
  timeLabel,
  toTime,
  type PriceRecord,
  type ProductRecord,
} from "@/features/orders/new/newOrderLogic";

const past = "2026-01-01T00:00:00Z";
const products: ProductRecord[] = [
  { id: "tom", product_name: "Tomatoes", unit_of_measurement: "kg", product_skus: [{ id: "tom-kg", selling_sku: "TOM-KG", unit_of_measurement: "kg", status: "active" }, { id: "tom-box", selling_sku: "TOM-BOX", unit_of_measurement: "box", status: "active" }] },
  { id: "car", product_name: "Carrots", unit_of_measurement: "kg", product_skus: [{ id: "car-kg", selling_sku: "CAR-KG", unit_of_measurement: "kg", status: "active" }] },
  { id: "new", product_name: "Ube", unit_of_measurement: "kg", product_skus: [] },
];
const list: PriceRecord[] = [
  { product_id: "tom", product_sku_id: null, selling_price: 85, effective_from: past, effective_to: null },
  { product_id: "tom", product_sku_id: null, selling_price: 70, effective_from: "2025-01-01T00:00:00Z", effective_to: null },
  { product_id: "tom", product_sku_id: "tom-box", selling_price: 900, effective_from: past, effective_to: null },
  { product_id: "car", product_sku_id: null, selling_price: 95, effective_from: past, effective_to: null },
  { product_id: "car", product_sku_id: null, selling_price: 99, effective_from: "2027-01-01T00:00:00Z", effective_to: null },
];
const now = Date.parse("2026-11-03T00:00:00Z");
const stock = [{ product_id: "car", sku_id: "car-kg", current_quantity: 2, status: "low_stock" as const }];

test("catalog: today's price per unit, customer price first, no price means no unit", () => {
  const catalog = buildCatalog(products, list, [{ product_id: "tom", product_sku_id: null, selling_price: 80, effective_from: past, effective_to: null }], stock, now);
  const tom = catalog.find((item) => item.id === "tom")!;
  assert.deepEqual(tom.units.map((unit) => [unit.unit, unit.price]), [["kg", 80], ["box", 900]]);
  assert.equal(catalog.find((item) => item.id === "car")!.units[0].price, 95, "a future price is not used yet");
  assert.equal(catalog.find((item) => item.id === "car")!.units[0].stock, 2);
  assert.deepEqual(catalog.find((item) => item.id === "new")!.units, [], "a product with no price cannot be added");
});

test("line amounts round once per line, like the server", () => {
  assert.equal(lineCents(0.333, 85.5), 2847); // 28.4715 → 28.47
  assert.equal(lineCents(0.333, 140), 4662); // 46.62
  assert.equal(lineCents(1.5, 85), 12750);
  const catalog = buildCatalog(products, list, [], stock, now);
  const lines = priceLines([{ productId: "tom", unitKey: "base", quantityText: "0.333" }, { productId: "car", unitKey: "base", quantityText: "0.333" }], catalog);
  // 0.333 × 85 = 28.305 → 28.31 and 0.333 × 95 = 31.635 → 31.64 (halves away from zero).
  assert.deepEqual(estimate(lines, null), { subtotal: 59.95, discount: 0, total: 59.95 });
  // 10% of 59.95 = 5.995 → 6.00.
  assert.deepEqual(estimate(lines, { type: "percent", value: 10, reason: "Promo" }), { subtotal: 59.95, discount: 6, total: 53.95 });
});

test("quantities: typed, stepped and cleaned", () => {
  assert.equal(stepQuantity("", 1), "1");
  assert.equal(stepQuantity("1", -1), "", "zero removes the line");
  assert.equal(stepQuantity("2.5", 1), "3.5");
  assert.equal(cleanQuantityInput("1.2345kg"), "1.234");
  assert.equal(cleanQuantityInput("1..5"), "1.5");
});

test("provisional stock rules: over stock is allowed with a warning", () => {
  const catalog = buildCatalog(products, list, [], stock, now);
  const lines = priceLines([{ productId: "car", unitKey: "base", quantityText: "5" }, { productId: "tom", unitKey: "base", quantityText: "1" }], catalog);
  assert.equal(lines[0].overStock, true);
  assert.equal(lines[1].overStock, false, "no stock record is not a warning");
  assert.match(stockWarning(lines) ?? "", /Carrots \(5 kg, 2 kg in stock\).*You can still save the order\. Stock is not reserved or deducted\./);
  assert.deepEqual(stockTag({ stock: 0, stockStatus: "out_of_stock", unit: "kg" }), { label: "Out of stock", tone: "danger" });
  assert.deepEqual(stockTag({ stock: 18, stockStatus: "low_stock", unit: "kg" }), { label: "Low · 18 kg left", tone: "warning" });
  assert.equal(stockWarning(lines.slice(1)), null);
});

test("a changed price needs a reason (administrators only send it)", () => {
  const catalog = buildCatalog(products, list, [], stock, now);
  const [same] = priceLines([{ productId: "tom", unitKey: "base", quantityText: "1", priceText: "85" }], catalog);
  assert.equal(same.special, false, "typing the list price is not a special price");
  const [changed] = priceLines([{ productId: "tom", unitKey: "base", quantityText: "2", priceText: "80" }], catalog);
  assert.equal(changed.special, true);
  assert.equal(changed.amountCents, 16000);
  assert.equal(priceProblem(changed), "Add a reason for the new price");
  assert.equal(priceProblem({ ...changed, line: { ...changed.line, priceReason: "Agreed" } }), null);
});

test("delivery time: labels, picker values and order", () => {
  assert.equal(timeLabel("07:00:00"), "7:00 AM");
  assert.equal(timeLabel("12:30"), "12:30 PM");
  assert.equal(timeLabel("00:15"), "12:15 AM");
  assert.equal(toTime(12, 0, "AM"), "00:00");
  assert.equal(toTime(1, 30, "PM"), "13:30");
  assert.deepEqual(fromTime("19:00"), { hour: 7, minute: 0, period: "PM" });
  assert.equal(deliveryTimeProblem({ start: null, end: "09:00", slotId: null }), "Add a start time before an end time");
  assert.equal(deliveryTimeProblem({ start: "09:00", end: "08:30", slotId: null }), "The end time must be after the start time");
  assert.equal(deliveryTimeProblem({ start: "07:00", end: null, slotId: null }), null);
  assert.equal(deliveryTimeText(null, null), "Not specified");
  assert.equal(deliveryTimeText("07:00:00", null), "From 7:00 AM");
  assert.equal(deliveryTimeText("07:00", "09:30"), "7:00 AM – 9:30 AM");
});

test("the saved payload sends no prices unless an administrator changed one", () => {
  const catalog = buildCatalog(products, list, [], stock, now);
  const lines = priceLines([
    { productId: "tom", unitKey: "tom-box", quantityText: "1" },
    { productId: "car", unitKey: "base", quantityText: "2", priceText: "90", priceReason: " Agreed " },
  ], catalog);
  const payload = buildPayload({
    customerId: "c1", date: "2026-11-04", sourceId: "s1", time: { start: "07:00", end: "09:00", slotId: null }, notes: " Gate 2 ",
    salesInvoice: " SI-00123 ", needsChecking: false, checkingNote: "ignored", discount: { type: "fixed", value: 100, reason: "Promo" },
  }, lines);
  assert.deepEqual(payload.p_order, {
    customer_id: "c1", requested_delivery_date: "2026-11-04", order_source_id: "s1", delivery_time_slot_id: null, delivery_time_start: "07:00", delivery_time_end: "09:00",
    notes: "Gate 2", sales_invoice_number: "SI-00123", requires_attention: false, attention_reason: "", discount: { type: "fixed", value: 100, reason: "Promo" },
  });
  assert.deepEqual(payload.p_items, [
    { product_id: "tom", product_sku_id: "tom-box", variety_id: null, quantity: 1, unit_of_measurement: "box", notes: "" },
    { product_id: "car", product_sku_id: null, variety_id: null, quantity: 2, unit_of_measurement: "kg", notes: "", special_price: 90, special_price_reason: "Agreed" },
  ]);
});
