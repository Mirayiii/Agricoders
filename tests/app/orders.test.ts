import assert from "node:assert/strict";
import { test } from "node:test";

import { orderSearchText } from "@/features/orders/orderSearch";

import { discountCents, discountProblem, parseAmount, previewTotal, salesInvoiceProblem, toCents } from "@/features/orders/orderMoney";
import { freshnessOf, savedAtLabel, staleMessage } from "@/services/data/staleness";

test("discount preview uses the server's rounding (D-O2)", () => {
  // Same cases as supabase/tests/phase3/01_order_money.sql.
  assert.equal(discountCents(toCents(896.62), "percent", 10), 8966);
  assert.equal(discountCents(toCents(1180), "percent", 10), 11800);
  assert.equal(discountCents(toCents(720), "fixed", 500), 50000);
  // Halves round away from zero: 0.05 x 50% = 0.025 -> 0.03.
  assert.equal(discountCents(5, "percent", 50), 3);
  // Never more than the subtotal, and 100% is everything.
  assert.equal(discountCents(toCents(100), "fixed", 150), 10000);
  assert.equal(discountCents(toCents(2210), "percent", 100), 221000);
  assert.equal(discountCents(toCents(2210), null, null), 0);
  assert.deepEqual(previewTotal(1570, { type: "fixed", valueText: "500", reason: "Late" }), { discount: 500, total: 1070 });
});

test("amounts are read the way staff type them", () => {
  assert.equal(parseAmount("500"), 500);
  assert.equal(parseAmount("₱ 1,250.50"), 1250.5);
  assert.equal(parseAmount("12.5%"), 12.5);
  assert.equal(parseAmount("10.005"), null);
  assert.equal(parseAmount("-5"), null);
  assert.equal(parseAmount("abc"), null);
});

test("discount form catches what the server refuses", () => {
  const ok = { type: "fixed" as const, valueText: "500", reason: "Late delivery" };
  assert.equal(discountProblem(ok, 2210), null);
  assert.equal(discountProblem({ ...ok, reason: "  " }, 2210), "A reason is required for a discount");
  assert.equal(discountProblem({ ...ok, valueText: "2210.01" }, 2210), "The discount cannot be more than the subtotal");
  assert.equal(discountProblem({ ...ok, valueText: "2210" }, 2210), null);
  assert.equal(discountProblem({ ...ok, type: "percent", valueText: "101" }, 2210), "A percentage discount cannot be more than 100%");
  assert.equal(discountProblem({ ...ok, valueText: "0" }, 2210), "Enter a discount greater than zero");
  assert.equal(discountProblem({ ...ok, valueText: "" }, 2210), "Enter the discount amount");
  assert.equal(discountProblem({ ...ok, reason: "x".repeat(201) }, 2210), "Keep the reason to 200 characters or fewer");
});

test("SI# accepts invoice-like text only", () => {
  assert.equal(salesInvoiceProblem("13451"), null);
  assert.equal(salesInvoiceProblem("SI-2026/0042"), null);
  assert.equal(salesInvoiceProblem(""), null);
  assert.notEqual(salesInvoiceProblem("13451; drop"), null);
  assert.notEqual(salesInvoiceProblem("x".repeat(41)), null);
});

test("saved data is marked stale only after a failed refresh", () => {
  const loadedAt = new Date(2026, 10, 3, 8, 5).getTime();
  assert.deepEqual(freshnessOf({ data: undefined, isRefetchError: false, dataUpdatedAt: 0 }), { stale: false });
  assert.deepEqual(freshnessOf({ data: [], isRefetchError: false, dataUpdatedAt: loadedAt }), { stale: false });
  assert.deepEqual(freshnessOf({ data: [], isRefetchError: true, dataUpdatedAt: loadedAt }), { stale: true, savedAt: loadedAt });
  // Without isRefetchError: an error newer than the data.
  assert.deepEqual(freshnessOf({ data: [], isError: true, dataUpdatedAt: loadedAt, errorUpdatedAt: loadedAt + 1 }), { stale: true, savedAt: loadedAt });
  assert.equal(savedAtLabel(loadedAt, new Date(2026, 10, 3, 12, 0).getTime()), "8:05 AM");
  assert.equal(savedAtLabel(loadedAt, new Date(2026, 10, 4, 9, 0).getTime()), "3 Nov, 8:05 AM");
  assert.equal(staleMessage(loadedAt, loadedAt), "Couldn’t refresh. Showing what was loaded at 8:05 AM.");
});

import { nextStepFor, orderEditing } from "@/features/orders/detail/nextStep";

const all = { manage: true, prepare: true, viewPurchasing: true, manageDeliveries: true, viewDeliveries: true, completeDelivery: true };
const none = { manage: false, prepare: false, viewPurchasing: false, manageDeliveries: false, viewDeliveries: false };

test("each status has its Figma primary action (task 3.3)", () => {
  const base = { flagged: false, packed: 2, itemCount: 4, delivery: null };
  assert.equal(nextStepFor({ ...base, status: "for_verification", can: all }).action?.label, "Confirm order");
  assert.equal(nextStepFor({ ...base, status: "confirmed", can: all }).action?.label, "Start packing");
  assert.equal(nextStepFor({ ...base, status: "for_preparation", can: all }).text, "Warehouse is packing — 2 of 4 packed.");
  assert.equal(nextStepFor({ ...base, status: "for_delivery", can: all, delivery: { status: "scheduled", when: "today at 10:30 AM", driver: "Rico", receivedBy: null } }).action?.label, "Mark delivered");
  const unassigned = nextStepFor({ ...base, status: "for_delivery", can: all, delivery: { status: "scheduled", when: "today at 10:30 AM", driver: null, receivedBy: null } });
  assert.equal(unassigned.action?.label, "Mark delivered", "prototype: no driver needed");
  // A driver or a booked stop doesn't mean it has left: only the stop's "Out for delivery" status does.
  assert.equal(unassigned.text, "Packed. Delivery today at 10:30 AM.");
  assert.equal(nextStepFor({ ...base, status: "for_delivery", can: all, delivery: { status: "for_delivery", when: "today at 10:30 AM", driver: "Rico", receivedBy: null } }).text, "Out for delivery today at 10:30 AM with Rico.");
  assert.equal(nextStepFor({ ...base, status: "completed", can: all, delivery: { status: "completed", when: "", driver: null, receivedBy: "Joy Santos" } }).text, "Delivered · received by Joy Santos. This order is locked.");
  assert.equal(nextStepFor({ ...base, status: "cancelled", can: all }).action, undefined);
  // Without the permission, the text stays and the button goes.
  assert.equal(nextStepFor({ ...base, status: "for_verification", can: none }).action, undefined);
});

test("what can change on an order matches the server rules", () => {
  assert.deepEqual(orderEditing("for_verification", true), { closed: false, canEditItems: true, canChangeDiscount: true, canSetSalesInvoice: true, salesInvoiceNeedsReason: false });
  assert.deepEqual(orderEditing("for_delivery", true), { closed: false, canEditItems: true, canChangeDiscount: true, canSetSalesInvoice: true, salesInvoiceNeedsReason: false });
  assert.deepEqual(orderEditing("completed", true), { closed: true, canEditItems: false, canChangeDiscount: false, canSetSalesInvoice: true, salesInvoiceNeedsReason: false });
  assert.deepEqual(orderEditing("cancelled", true), { closed: true, canEditItems: false, canChangeDiscount: false, canSetSalesInvoice: false, salesInvoiceNeedsReason: false });
  // Completed order with an SI#: only an administrator may replace it, with a reason.
  assert.deepEqual(orderEditing("completed", true, { hasSalesInvoice: true }), { closed: true, canEditItems: false, canChangeDiscount: false, canSetSalesInvoice: false, salesInvoiceNeedsReason: true });
  assert.deepEqual(orderEditing("completed", true, { hasSalesInvoice: true, isAdministrator: true }), { closed: true, canEditItems: false, canChangeDiscount: false, canSetSalesInvoice: true, salesInvoiceNeedsReason: true });
  assert.deepEqual(orderEditing("for_delivery", true, { hasSalesInvoice: true }).salesInvoiceNeedsReason, false);
  assert.deepEqual(orderEditing("for_verification", false), { closed: false, canEditItems: false, canChangeDiscount: false, canSetSalesInvoice: false, salesInvoiceNeedsReason: false });
});

import { describeActivity } from "@/features/orders/status";

test("the activity log shows reasons and the previous SI#", () => {
  assert.equal(describeActivity("discount_removed", { reason: "Applied by mistake" }), "Discount removed: Applied by mistake");
  assert.equal(describeActivity("sales_invoice_set", { from: null, to: "13451" }), "SI# set to 13451");
  assert.equal(describeActivity("sales_invoice_set", { from: "13451", to: "13452", reason: "Typo" }), "SI# changed from 13451 to 13452 (Typo)");
  assert.equal(describeActivity("sales_invoice_set", { from: "13451", to: null, reason: "Wrong order" }), "SI# 13451 removed (Wrong order)");
});

test("Orders search matches the order number, DR# and customer (requirement OM-01)", () => {
  const order = { order_number: "ORD-1043", customers: { business_name: "Negril Trading", brand_name: "Casa Verde" }, delivery_receipts: { dr_number: 7 } };
  const text = orderSearchText(order);
  for (const term of ["ord-1043", "dr-0007", "dr0007", "0007", "negril", "casa verde"]) assert.ok(text.includes(term), term);
  assert.ok(orderSearchText({ ...order, delivery_receipts: [{ dr_number: 12 }] }).includes("dr-0012"), "array form from the API");
  assert.ok(!orderSearchText({ ...order, delivery_receipts: null }).includes("dr-"), "no receipt yet");
});

test("repacking after an edit: the next step says so and offers no Mark delivered", () => {
  const delivery = { status: "scheduled" as const, when: "today at 10:30 AM", driver: "Rico", receivedBy: null };
  const step = nextStepFor({ flagged: false, packed: 3, itemCount: 4, removalsToConfirm: 1, delivery, status: "for_preparation", can: all });
  assert.equal(step.text, "Changed after packing — warehouse is repacking, 3 of 4 packed. 1 removed item needs to be taken out. The delivery today at 10:30 AM stays booked.");
  assert.notEqual(step.action?.key, "markDelivered");
  assert.equal(nextStepFor({ flagged: false, packed: 1, itemCount: 2, removalsToConfirm: 2, delivery: null, status: "for_preparation", can: none }).text, "Warehouse is packing — 1 of 2 packed. 2 removed items need to be taken out.");
});

test("the activity log describes edits, repacking and removed items", () => {
  assert.equal(describeActivity("order_edited", { changed_lines: [{}], added_lines: [], removed_lines: [{}, {}], repack_required: true }), "Order edited · items 1 changed, 2 removed · repack needed");
  assert.equal(describeActivity("order_edited", { changed_lines: [], added_lines: [], removed_lines: [], notes_changed: true, repack_required: false }), "Order edited");
  assert.equal(describeActivity("status_changed", { to_status: "for_preparation", reason: "repack_required" }), "Sent back to Packing after a change");
  assert.equal(describeActivity("removed_item_confirmed", { description: "Tomatoes" }), "Tomatoes confirmed taken out of the packed order");
});
