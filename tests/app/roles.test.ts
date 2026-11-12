import assert from "node:assert/strict";
import { test } from "node:test";

import { isTabVisible, MAIN_TABS } from "@/constants/navigation";
import { hasPermission, PERMISSIONS } from "@/constants/permissions";
import { ROLE_META } from "@/constants/roles";
import { homeCounts, homeKindFor, type HomeOrder } from "@/features/dashboard/homeLogic";
import type { ProfileRole } from "@/types/auth";

const tabsFor = (role: ProfileRole) => MAIN_TABS.filter((tab) => isTabVisible(tab, role)).map((tab) => tab.label);

test("each role sees exactly its Figma tabs (task 2.1)", () => {
  assert.deepEqual(tabsFor("administrator"), ["Home", "Orders", "Purchasing", "Deliveries", "More"]);
  assert.deepEqual(tabsFor("administrative_staff"), ["Home", "Orders", "Deliveries", "More"]);
  assert.deepEqual(tabsFor("fulfillment_staff"), ["Home", "Purchasing", "More"]);
  assert.deepEqual(tabsFor("delivery_staff"), ["Home", "Deliveries", "More"]);
});

test("hidden tabs are also refused by the route gate", () => {
  // Each tab route is wrapped in PermissionGate with the tab's permission.
  assert.equal(hasPermission("delivery_staff", PERMISSIONS.viewFulfillment), false);
  assert.equal(hasPermission("fulfillment_staff", PERMISSIONS.viewOrders), false);
  assert.equal(hasPermission("fulfillment_staff", PERMISSIONS.viewDeliveries), false);
  assert.equal(hasPermission("administrative_staff", PERMISSIONS.viewFulfillment), false);
});

test("fulfillment_staff is shown as Purchasing staff (D-R1, label only)", () => {
  assert.equal(ROLE_META.fulfillment_staff.label, "Purchasing staff");
  assert.equal(ROLE_META.administrative_staff.label, "Administrative staff");
});

test("Home per role", () => {
  assert.equal(homeKindFor("administrator"), "office");
  assert.equal(homeKindFor("administrative_staff"), "office");
  assert.equal(homeKindFor("fulfillment_staff"), "purchasing");
  assert.equal(homeKindFor("delivery_staff"), "delivery");
});

test("Home counts come from the listed rows", () => {
  const order = (status: HomeOrder["status"], extra: Partial<HomeOrder> = {}): HomeOrder => ({
    id: Math.random().toString(), order_number: "DR-1", status, requested_delivery_date: "2026-11-03",
    requires_attention: false, attention_reason: null, customers: null, order_items: [], ...extra,
  });
  const counts = homeCounts(
    [
      order("for_verification"), order("for_verification", { requires_attention: true }), order("confirmed"),
      order("for_preparation", { order_items: [{ id: "a", preparation_status: "completed" }, { id: "b", preparation_status: "pending" }, { id: "c", preparation_status: "in_progress" }] }),
      order("completed", { requires_attention: true }),
    ],
    [
      { id: "1", order_id: "x", scheduled_time: null, status: "scheduled", orders: null },
      { id: "2", order_id: "y", scheduled_time: null, status: "for_delivery", orders: null },
      { id: "3", order_id: "z", scheduled_time: null, status: "completed", orders: null },
      { id: "4", order_id: "w", scheduled_time: null, status: "cancelled", orders: null },
    ],
  );
  assert.equal(counts.toVerify, 2);
  assert.equal(counts.confirmed, 1);
  assert.equal(counts.beingPacked, 1);
  assert.equal(counts.flagged, 1, "completed orders are never flagged");
  assert.equal(counts.itemsLeftToPack, 2);
  assert.equal(counts.stopsLeft, 2);
  assert.equal(counts.deliveredToday, 1);
  assert.equal(counts.deliveriesToday, 3, "cancelled deliveries are not counted");
});

test("delivery completion and receipts follow the prototype and DE-03", async () => {
  const { RECEIPT_STATUSES, canCompleteDelivery } = await import("@/features/deliveries/deliveriesLogic");
  // Prototype (5 Nov, replaces DE-04): administrator and office for any stop, drivers for their own; no driver needed.
  assert.equal(canCompleteDelivery("administrator", null, "a"), true, "no driver assigned: the administrator can");
  assert.equal(canCompleteDelivery("administrative_staff", null, "c1"), true, "and so can the office");
  assert.equal(canCompleteDelivery("delivery_staff", null, "d1"), false, "a driver only completes their own stop");
  assert.equal(canCompleteDelivery("administrator", "d1", "a"), true);
  assert.equal(canCompleteDelivery("delivery_staff", "d1", "d1"), true);
  assert.equal(canCompleteDelivery("delivery_staff", "d2", "d1"), false, "only their own stop");
  assert.equal(canCompleteDelivery("administrative_staff", "d1", "c1"), true);
  assert.equal(canCompleteDelivery("fulfillment_staff", "d1", "f1"), false);
  assert.ok(RECEIPT_STATUSES.includes("confirmed"), "the receipt is available from Confirmed");
  assert.ok(!RECEIPT_STATUSES.includes("for_verification"));
});
