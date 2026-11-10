import assert from "node:assert/strict";
import { test } from "node:test";

import { activePreviewRole, canPreviewRoles, previewedProfile } from "@/features/auth/rolePreview";
import { moreMenu } from "@/features/more/moreMenu";
import { notificationSettings } from "@/features/settings/settingsLogic";
import { credentialsText, filterUsers, matchesSearch, roleCounts, userBadge } from "@/features/users/usersLogic";
import type { Profile } from "@/types/auth";

const profile = (extra: Partial<Profile>): Profile => ({
  id: "u1", full_name: "Ana Mercado", email: "ana@meah.test", role: "administrator", status: "active", username: "ana.mercado",
  must_change_password: false, must_change_reason: null, temp_password_expires_at: null, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
  ...extra,
});

test("More menu per role follows requirement SI-02", () => {
  assert.deepEqual(moreMenu("administrator").map((item) => item.title), ["User management", "Customers", "Products & stock", "Reports", "Notifications", "Settings"]);
  assert.deepEqual(moreMenu("administrative_staff").map((item) => item.title), ["Customers", "Notifications", "Settings"]);
  assert.deepEqual(moreMenu("fulfillment_staff").map((item) => item.title), ["Notifications", "Settings"]);
  assert.deepEqual(moreMenu("delivery_staff").map((item) => item.title), ["Notifications", "Settings"]);
});

test("only an active administrator can preview roles", () => {
  assert.equal(canPreviewRoles(profile({})), true);
  assert.equal(canPreviewRoles(profile({ role: "administrative_staff" })), false);
  assert.equal(canPreviewRoles(profile({ status: "inactive" })), false);
  assert.equal(canPreviewRoles(null), false);
});

test("a role preview swaps only the role, and only for the administrator who started it", () => {
  const admin = profile({});
  const preview = { userId: "u1", role: "delivery_staff" as const };
  const shown = previewedProfile(admin, preview);
  assert.equal(shown?.role, "delivery_staff");
  assert.deepEqual({ ...shown, role: "administrator" }, admin, "everything else is the real profile");
  assert.equal(admin.role, "administrator", "the real profile is not changed");
  assert.equal(activePreviewRole(admin, preview), "delivery_staff");
  // Another account, a non-administrator or the own role: no preview.
  assert.equal(activePreviewRole(profile({ id: "u2" }), preview), null);
  assert.equal(previewedProfile(profile({ role: "administrative_staff" }), { userId: "u1", role: "delivery_staff" })?.role, "administrative_staff");
  assert.equal(activePreviewRole(admin, { userId: "u1", role: "administrator" }), null);
  assert.equal(activePreviewRole(admin, null), null);
});

test("AS-03: push switches only for the events each role already receives", () => {
  const keys = (role: Parameters<typeof notificationSettings>[0]) => notificationSettings(role).map((row) => row.key);
  assert.deepEqual(keys("administrator"), ["delivery_reminders", "push_new_orders", "push_flagged_orders", "push_delivery_reminders"]);
  assert.deepEqual(keys("administrative_staff"), ["delivery_reminders", "push_new_orders", "push_flagged_orders", "push_delivery_reminders"]);
  assert.deepEqual(keys("delivery_staff"), ["delivery_reminders", "push_delivery_reminders"]);
  assert.deepEqual(keys("fulfillment_staff"), ["push_ready_to_buy"], "purchasing staff: Ready to buy only, no in-app reminder switch");
  assert.deepEqual(keys(null), []);
  const driverPush = notificationSettings("delivery_staff").find((row) => row.kind === "push");
  assert.match(driverPush?.description ?? "", /your own stops/);
  assert.ok(!keys("administrator").some((key) => key.includes("stock")), "no low-stock switch: there is no such event");
});

test("AS-03: the app's switch list matches the server's", async () => {
  const { readFileSync } = await import("node:fs");
  const { PUSH_CATEGORIES_BY_ROLE } = await import("@/features/settings/settingsLogic");
  const { readdirSync } = await import("node:fs");
  // The latest migration that defines the list wins.
  const sql = readdirSync("supabase/migrations").sort().reverse()
    .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
    .find((text) => text.includes("function public.push_categories_for_role")) ?? "";
  const body = sql.slice(sql.indexOf("function public.push_categories_for_role"), sql.indexOf("function public.push_category_for_type"));
  for (const [role, categories] of Object.entries(PUSH_CATEGORIES_BY_ROLE)) {
    const match = body.match(new RegExp(`when '${role}' then array\\[([^\\]]*)\\]`));
    const server = match ? [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
    assert.deepEqual(server, [...categories], role);
  }
});

test("user search and role filters", () => {
  const users = [
    profile({ id: "a", full_name: "Ana Mercado", username: "ana.mercado" }),
    profile({ id: "b", full_name: "Liza Ramos", username: "liza.ramos", role: "administrative_staff" }),
    profile({ id: "c", full_name: "Rico Bautista", username: "rico.b", role: "delivery_staff", status: "inactive" }),
    profile({ id: "d", full_name: "Jun Villanueva", username: "jun.v", role: "delivery_staff" }),
  ];
  const locks = new Map([["d", "2026-11-04T10:00:00Z"]]);
  const ids = (list: Profile[]) => list.map((user) => user.id);
  assert.deepEqual(ids(filterUsers(users, { query: "", role: "all" })), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(filterUsers(users, { query: "@LIZA", role: "all" })), ["b"], "search ignores case and a leading @");
  assert.deepEqual(ids(filterUsers(users, { query: "", role: "delivery_staff" })), ["c", "d"], "inactive users stay in the list");
  assert.deepEqual(ids(filterUsers(users, { query: "rico", role: "delivery_staff" })), ["c"]);
  assert.deepEqual(roleCounts(users), { all: 4, administrator: 1, administrative_staff: 1, fulfillment_staff: 0, delivery_staff: 2 });
  assert.equal(credentialsText({ username: "liza.ramos", password: "Tmp-1234" }), "Username: liza.ramos | Password: Tmp-1234");
  assert.equal(matchesSearch(users[0], "mercado"), true);
  assert.deepEqual(userBadge(users[3], locks), { label: "Locked", tone: "warning" });
  assert.deepEqual(userBadge(users[2], locks), { label: "Inactive", tone: "neutral" });
});

test("the More menu doesn't widen administrative staff permissions", async () => {
  const { PERMISSIONS, hasPermission } = await import("@/constants/permissions");
  // Order-price overrides stay administrator-only (the server checks it too, phase4 tests).
  for (const permission of [PERMISSIONS.manageUsers, PERMISSIONS.viewReports]) {
    assert.equal(hasPermission("administrative_staff", permission), false);
  }
  // Requirements SI-02 and PS-01 to PS-03: Products & stock is the administrator's only.
  for (const role of ["administrative_staff", "fulfillment_staff", "delivery_staff"] as const) {
    for (const permission of [PERMISSIONS.viewInventory, PERMISSIONS.manageInventory, PERMISSIONS.manageProducts, PERMISSIONS.managePricing, PERMISSIONS.archiveCustomers]) {
      assert.equal(hasPermission(role, permission), false, `${role} ${permission}`);
    }
  }
  assert.equal(hasPermission("administrative_staff", PERMISSIONS.manageCustomers), true, "office staff still add and edit customers");
  assert.equal(hasPermission("administrator", PERMISSIONS.archiveCustomers), true);
});
