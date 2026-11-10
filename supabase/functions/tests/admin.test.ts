import assert from "node:assert/strict";
import { test } from "node:test";

import { adminCreateUser, staffAuthEmail } from "../_shared/adminCreate.ts";
import { adminResetPassword } from "../_shared/adminReset.ts";
import { failedPasswordRules } from "../_shared/passwordRules.ts";
import { FakeWorld } from "./fakeWorld.ts";

const REQ = "33333333-3333-4333-8333-333333333333";
const REQ2 = "44444444-4444-4444-8444-444444444444";

function setup() {
  const w = new FakeWorld();
  const admin = w.addUser({ username: "admin", password: "Admin#123", role: "administrator" });
  const staff = w.addUser({ username: "ben", password: "Staff#123", role: "fulfillment_staff" });
  return { w, admin, staff, adminToken: w.openSession(admin.user_id).token, staffToken: w.openSession(staff.user_id).token };
}

const createInput = (token: string, extra: Record<string, unknown> = {}) => ({
  token, requestId: REQ, username: "Maria.Cruz", fullName: " Maria Cruz ", role: "delivery_staff", contactEmail: "", ...extra,
});

test("reset: sets a temporary password, flags the account and ends its sessions", async () => {
  const { w, staff, adminToken } = setup();
  const r = await adminResetPassword(w.resetDeps(), { token: adminToken, requestId: REQ, userId: staff.user_id });
  assert.equal(r.result, "ok");
  assert.ok("temporary_password" in r);
  assert.deepEqual(failedPasswordRules(r.temporary_password), []);
  const u = w.users.get(staff.user_id)!;
  assert.equal(u.password, r.temporary_password);
  assert.equal(u.must_change_reason, "temporary_password");
  assert.equal(w.sessionsOf(staff.user_id).length, 0);
});

test("reset: a retry shows the same password and does not reset again", async () => {
  const { w, staff, adminToken } = setup();
  const a = await adminResetPassword(w.resetDeps(), { token: adminToken, requestId: REQ, userId: staff.user_id });
  const version = w.users.get(staff.user_id)!.password_version;
  const b = await adminResetPassword(w.resetDeps(), { token: adminToken, requestId: REQ, userId: staff.user_id });
  assert.deepEqual(a, b);
  assert.equal(w.users.get(staff.user_id)!.password_version, version);
  const c = await adminResetPassword(w.resetDeps(), { token: adminToken, requestId: REQ2, userId: staff.user_id });
  assert.ok("temporary_password" in a && "temporary_password" in c && a.temporary_password !== c.temporary_password);
});

test("reset: a crash after the Auth step is finished by the retry", async () => {
  const { w, staff, adminToken } = setup();
  const deps = w.resetDeps({ revokeAllSessions: async () => { throw new Error("network"); } });
  await assert.rejects(adminResetPassword(deps, { token: adminToken, requestId: REQ, userId: staff.user_id }));
  assert.equal(w.locks.size, 0, "the lock is released");
  const r = await adminResetPassword(w.resetDeps(), { token: adminToken, requestId: REQ, userId: staff.user_id });
  assert.equal(r.result, "ok");
  assert.equal(w.sessionsOf(staff.user_id).length, 0);
});

test("reset: only active administrators, never on themselves", async () => {
  const { w, admin, staff, adminToken, staffToken } = setup();
  assert.equal((await adminResetPassword(w.resetDeps(), { token: staffToken, requestId: REQ, userId: admin.user_id })).result, "forbidden");
  assert.equal((await adminResetPassword(w.resetDeps(), { token: "x", requestId: REQ, userId: staff.user_id })).result, "unauthorized");
  assert.equal((await adminResetPassword(w.resetDeps(), { token: adminToken, requestId: REQ, userId: admin.user_id })).result, "self_reset");
  assert.equal((await adminResetPassword(w.resetDeps(), { token: adminToken, requestId: "nope", userId: staff.user_id })).result, "invalid_request");
});

test("reset: the same request id for another user is refused", async () => {
  const { w, admin, staff, adminToken } = setup();
  const other = w.addUser({ username: "cara", password: "Cara#1234" });
  await adminResetPassword(w.resetDeps(), { token: adminToken, requestId: REQ, userId: staff.user_id });
  const r = await adminResetPassword(w.resetDeps(), { token: adminToken, requestId: REQ, userId: other.user_id });
  assert.equal(r.result, "request_id_reused");
  void admin;
});

test("create: makes an active, flagged account with an internal email", async () => {
  const { w, adminToken } = setup();
  const r = await adminCreateUser(w.createDeps(), createInput(adminToken));
  assert.equal(r.result, "ok");
  assert.ok("user_id" in r);
  const u = w.users.get(r.user_id)!;
  assert.equal(u.username, "maria.cruz");
  assert.equal(u.full_name, "Maria Cruz");
  assert.equal(u.role, "delivery_staff");
  assert.equal(u.status, "active");
  assert.equal(u.must_change_password, true);
  assert.equal(u.email, `${REQ}@staff.meah.invalid`);
  assert.equal(u.password, r.temporary_password);
  assert.deepEqual(failedPasswordRules(r.temporary_password), []);
});

test("create: a retry returns the same account and password", async () => {
  const { w, adminToken } = setup();
  const a = await adminCreateUser(w.createDeps(), createInput(adminToken));
  const count = w.users.size;
  const b = await adminCreateUser(w.createDeps(), createInput(adminToken));
  assert.deepEqual(a, b);
  assert.equal(w.users.size, count);
});

test("create: a crash after the Auth user was made is finished by the retry", async () => {
  const { w, adminToken } = setup();
  const deps = w.createDeps({ setRequestTarget: async () => { throw new Error("network"); } });
  await assert.rejects(adminCreateUser(deps, createInput(adminToken)));
  const count = w.users.size;
  const r = await adminCreateUser(w.createDeps(), createInput(adminToken));
  assert.equal(r.result, "ok");
  assert.equal(w.users.size, count, "no second Auth user");
  assert.equal(w.users.get(("user_id" in r && r.user_id) as string)!.email, staffAuthEmail(REQ));
});

test("create: same request id with different details is refused", async () => {
  const { w, adminToken } = setup();
  await adminCreateUser(w.createDeps(), createInput(adminToken));
  const r = await adminCreateUser(w.createDeps(), createInput(adminToken, { role: "administrator" }));
  assert.equal(r.result, "request_id_reused");
});

test("create: refuses a taken username and bad fields", async () => {
  const { w, adminToken, staffToken } = setup();
  assert.equal((await adminCreateUser(w.createDeps(), createInput(adminToken, { username: "Ben" }))).result, "username_taken");
  assert.deepEqual(await adminCreateUser(w.createDeps(), createInput(adminToken, { requestId: REQ2, username: "1abc" })), { result: "invalid_field", field: "username" });
  assert.deepEqual(await adminCreateUser(w.createDeps(), createInput(adminToken, { requestId: REQ2, role: "owner" })), { result: "invalid_field", field: "role" });
  assert.deepEqual(await adminCreateUser(w.createDeps(), createInput(adminToken, { requestId: REQ2, fullName: "  " })), { result: "invalid_field", field: "full_name" });
  assert.deepEqual(await adminCreateUser(w.createDeps(), createInput(adminToken, { requestId: REQ2, contactEmail: "nope" })), { result: "invalid_field", field: "contact_email" });
  assert.equal((await adminCreateUser(w.createDeps(), createInput(staffToken, { requestId: REQ2 }))).result, "forbidden");
});
