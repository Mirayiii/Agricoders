import assert from "node:assert/strict";
import { test } from "node:test";

import {
  codeLine,
  customerName,
  contactLine,
  draftChanged,
  draftFrom,
  draftPayload,
  draftProblem,
  EMPTY_DRAFT,
  historySummary,
  presetCustomerNotice,
  searchCustomers,
  statusCounts,
  type CustomerRow,
} from "@/features/customers/customersLogic";

const row = (extra: Partial<CustomerRow>): CustomerRow => ({
  id: "c1", customer_code: "CUS-0012", business_name: "Casa Verde Restaurant", brand_name: null, tin: null, contact_person: "Mark Reyes", phone: "0917 555 0142",
  email: null, delivery_address: null, notes: null, status: "active", archived_at: null, order_count: 8, last_order_date: "2026-08-29", ...extra,
});

test("search: name, code, contact person or phone, ignoring spaces in phone numbers", () => {
  const rows = [row({}), row({ id: "c2", business_name: "Sampaguita Hotel", customer_code: "CUS-0007", contact_person: "Joy Santos", phone: "0918-555-2231" })];
  assert.deepEqual(searchCustomers(rows, "casa").map((r) => r.id), ["c1"]);
  assert.deepEqual(searchCustomers(rows, "cus-0007").map((r) => r.id), ["c2"]);
  assert.deepEqual(searchCustomers(rows, "joy").map((r) => r.id), ["c2"]);
  assert.deepEqual(searchCustomers(rows, "09185552231").map((r) => r.id), ["c2"]);
  assert.deepEqual(searchCustomers(rows, "0917 555").map((r) => r.id), ["c1"]);
  assert.equal(searchCustomers(rows, "  ").length, 2);
});

test("Active and Archived counts follow the search", () => {
  const rows = [row({}), row({ id: "c2", status: "archived" }), row({ id: "c3" })];
  assert.deepEqual(statusCounts(rows), { active: 2, archived: 1 });
});

test("row lines match Figma", () => {
  assert.equal(contactLine(row({})), "Mark Reyes · 0917 555 0142");
  assert.equal(contactLine(row({ contact_person: null })), "0917 555 0142");
  assert.equal(contactLine(row({ contact_person: null, phone: null })), "No contact recorded");
  assert.equal(codeLine(row({})), "CUS-0012 · 8 orders");
  assert.equal(codeLine(row({ order_count: 1 })), "CUS-0012 · 1 order");
});

test("order history summary uses the latest delivery date", () => {
  assert.equal(historySummary(8, "2026-08-29"), "8 orders · last on Sat, 29 Aug");
  assert.equal(historySummary(1, "2026-08-29"), "1 order · last on Sat, 29 Aug");
  assert.equal(historySummary(0, null), "No orders yet");
});

test("form: code and business name required; blanks saved as not recorded", () => {
  assert.equal(draftProblem(EMPTY_DRAFT), "Enter a customer code");
  assert.equal(draftProblem({ ...EMPTY_DRAFT, customer_code: "CUS-1" }), "Enter the business name");
  assert.equal(draftProblem({ ...EMPTY_DRAFT, customer_code: "CUS-1", business_name: "X" }), null);
  const payload = draftPayload({ ...EMPTY_DRAFT, customer_code: " CUS-1 ", business_name: "  Casa   Verde ", email: "  " });
  assert.equal(payload.customer_code, "CUS-1");
  assert.equal(payload.business_name, "Casa Verde");
  assert.equal(payload.email, null);
  // Requirement CU-01: business type and preferred delivery window, optional.
  const typed = draftPayload({ ...EMPTY_DRAFT, customer_code: "C", business_name: "B", business_type: "  Hotel   chain ", preferred_delivery_window: " 6 to 9 AM " });
  assert.equal(typed.business_type, "Hotel chain");
  assert.equal(typed.preferred_delivery_window, "6 to 9 AM");
  assert.equal(payload.business_type, null);
});

test("form: Save changes only when something changed", () => {
  const original = draftFrom(row({}));
  assert.equal(draftChanged({ ...original, phone: " 0917 555 0142 " }, original), false);
  assert.equal(draftChanged({ ...original, phone: "0917 555 0000" }, original), true);
});

test("New order opened for an archived customer explains why nobody is picked", () => {
  assert.equal(presetCustomerNotice("c1", ["c1"]), null);
  assert.equal(presetCustomerNotice(undefined, []), null);
  assert.match(presetCustomerNotice("c9", ["c1"]) ?? "", /archived/);
});

test("brand name is the display name when recorded; TIN# is searchable and kept as typed", () => {
  assert.equal(customerName({ business_name: "Casa Verde Holdings Inc.", brand_name: "Casa Verde Restaurant" }), "Casa Verde Restaurant");
  assert.equal(customerName({ business_name: "Casa Verde Holdings Inc.", brand_name: "  " }), "Casa Verde Holdings Inc.");
  assert.equal(customerName({ business_name: "Casa Verde Holdings Inc.", brand_name: null }), "Casa Verde Holdings Inc.");
  const rows = [row({ business_name: "Casa Verde Holdings Inc.", brand_name: "Casa Verde Restaurant", tin: "001-234-567-000" })];
  assert.equal(searchCustomers(rows, "holdings").length, 1);
  assert.equal(searchCustomers(rows, "restaurant").length, 1);
  assert.equal(searchCustomers(rows, "001234567").length, 1);
  assert.equal(draftPayload({ ...EMPTY_DRAFT, customer_code: "C", business_name: "B", tin: " 001-234-567-000 " }).tin, "001-234-567-000");
  assert.equal(draftPayload({ ...EMPTY_DRAFT, customer_code: "C", business_name: "B", brand_name: "  " }).brand_name, null);
});
