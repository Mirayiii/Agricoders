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

test("More menu per role follows the prototype", () => {
  assert.deepEqual(moreMenu("administrator").map((item) => item.title), ["User management", "Customers", "Products & stock", "Reports", "Notifications", "Settings"]);
  assert.deepEqual(moreMenu("administrative_staff").map((item) => item.title), ["Customers", "Products & stock", "Notifications", "Settings"]);
  assert.deepEqual(moreMenu("fulfillment_staff").map((item) => item.title), ["Products & stock", "Notifications", "Settings"]);
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

test("Settings: the prototype's three switches, per role", () => {
  const titles = (role: Parameters<typeof notificationSettings>[0]) => notificationSettings(role).map((row) => row.title);
  assert.deepEqual(titles("administrator"), ["Push notifications", "Delivery reminders", "Low-stock alerts"], "as in Figma 25:2115");
  assert.deepEqual(titles("administrative_staff"), ["Push notifications", "Delivery reminders"]);
  assert.deepEqual(titles("fulfillment_staff"), ["Push notifications", "Low-stock alerts"]);
  assert.deepEqual(titles("delivery_staff"), ["Push notifications", "Delivery reminders"]);
  assert.deepEqual(titles(null), []);
  assert.deepEqual(notificationSettings("administrator").map((row) => row.description), ["Alerts on this phone", "Day before and morning of", "When stock reaches its alert level"]);
  // Push sending and low-stock alerts aren't built yet: those switches are disabled, "Not available yet".
  assert.deepEqual(notificationSettings("administrator").map((row) => row.available), [false, true, false]);
});

test("Settings: the app's switch list matches the server's", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { SETTINGS_BY_ROLE } = await import("@/features/settings/settingsLogic");
  // The latest migration that defines the list wins.
  const sql = readdirSync("supabase/migrations").sort().reverse()
    .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
    .find((text) => text.includes("function public.settings_switches_for_role")) ?? "";
  const body = sql.slice(sql.indexOf("function public.settings_switches_for_role"), sql.indexOf("function public.set_my_setting"));
  for (const [role, keys] of Object.entries(SETTINGS_BY_ROLE)) {
    const match = body.match(new RegExp(`when '${role}' then array\\[([^\\]]*)\\]`));
    const server = match ? [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
    assert.deepEqual(server, [...keys], role);
  }
});

test("Settings: the app and server agree on which switches work yet", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { AVAILABLE_SETTINGS } = await import("@/features/settings/settingsLogic");
  const sql = readdirSync("supabase/migrations").sort().reverse()
    .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
    .find((text) => text.includes("function public.setting_available")) ?? "";
  const body = sql.slice(sql.indexOf("function public.setting_available"), sql.indexOf("function public.set_my_setting"));
  const server = [...body.matchAll(/p_key = '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(server, [...AVAILABLE_SETTINGS]);
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

test("role permissions follow the prototype", async () => {
  const { PERMISSIONS, hasPermission } = await import("@/constants/permissions");
  // User management and Reports stay with the administrator (the server checks it too).
  for (const role of ["administrative_staff", "fulfillment_staff", "delivery_staff"] as const) {
    for (const permission of [PERMISSIONS.manageUsers, PERMISSIONS.viewReports]) {
      assert.equal(hasPermission(role, permission), false, `${role} ${permission}`);
    }
  }
  // Products & stock: administrative and purchasing staff; prices and customer archive: administrative staff.
  const expected = {
    administrative_staff: { viewInventory: true, manageInventory: true, manageProducts: true, managePricing: true, archiveCustomers: true },
    fulfillment_staff: { viewInventory: true, manageInventory: true, manageProducts: true, managePricing: false, archiveCustomers: false },
    delivery_staff: { viewInventory: false, manageInventory: false, manageProducts: false, managePricing: false, archiveCustomers: false },
  } as const;
  for (const [role, permissions] of Object.entries(expected) as [keyof typeof expected, Record<string, boolean>][]) {
    for (const [permission, allowed] of Object.entries(permissions)) {
      assert.equal(hasPermission(role, permission as never), allowed, `${role} ${permission}`);
    }
  }
  assert.equal(hasPermission("administrative_staff", PERMISSIONS.manageCustomers), true, "office staff still add and edit customers");
  assert.equal(hasPermission("administrator", PERMISSIONS.archiveCustomers), true);
});
