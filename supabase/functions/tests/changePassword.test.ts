import assert from "node:assert/strict";
import { test } from "node:test";

import { adminResetPassword } from "../_shared/adminReset.ts";
import { staffChangePassword } from "../_shared/changePassword.ts";
import { FakeWorld } from "./fakeWorld.ts";

function setup(extra: Record<string, unknown> = {}) {
  const w = new FakeWorld();
  const admin = w.addUser({ username: "admin", password: "Admin#123", role: "administrator" });
  const user = w.addUser({
    username: "maria", password: "Temp#1234", must_change_password: true, must_change_reason: "temporary_password",
    temp_password_expires_at: new Date(w.now.getTime() + 3600_000).toISOString(), ...extra,
  });
  const session = w.openSession(user.user_id);
  const other = w.openSession(user.user_id);
  const adminSession = w.openSession(admin.user_id);
  return { w, admin, user, session, other, adminSession };
}

test("changes the password, clears the flag and ends the other sessions", async () => {
  const { w, user, session, other } = setup();
  const r = await staffChangePassword(w.changeDeps(), { token: session.token, currentPassword: "Temp#1234", newPassword: "NewPass#99" });
  assert.deepEqual(r, { result: "ok" });
  const u = w.users.get(user.user_id)!;
  assert.equal(u.password, "NewPass#99");
  assert.equal(u.must_change_password, false);
  assert.equal(u.password_version, 2);
  assert.ok(w.sessions.some((s) => s.id === session.id));
  assert.ok(!w.sessions.some((s) => s.id === other.id));
  assert.equal(w.locks.size, 0);
});

test("refuses weak passwords and lists the failed rules (D5)", async () => {
  const { w, session } = setup();
  const r = await staffChangePassword(w.changeDeps(), { token: session.token, currentPassword: "Temp#1234", newPassword: "short" });
  assert.equal(r.result, "weak_password");
  assert.deepEqual("failed_rules" in r && r.failed_rules, ["length", "case", "number", "special"]);
});

test("refuses the temporary password as the new one", async () => {
  const { w, session } = setup({ password: "Temp#12345" });
  const r = await staffChangePassword(w.changeDeps(), { token: session.token, currentPassword: "Temp#12345", newPassword: "Temp#12345" });
  assert.equal(r.result, "same_password");
});

test("a wrong current password counts toward the lockout", async () => {
  const { w, user, session } = setup();
  for (let i = 0; i < 5; i += 1) {
    const r = await staffChangePassword(w.changeDeps(), { token: session.token, currentPassword: "nope", newPassword: "NewPass#99" });
    assert.equal(r.result, "invalid_current");
  }
  const r = await staffChangePassword(w.changeDeps(), { token: session.token, currentPassword: "Temp#1234", newPassword: "NewPass#99" });
  assert.equal(r.result, "locked");
  assert.equal(w.users.get(user.user_id)!.must_change_password, true);
});

test("an expired temporary password cannot be changed", async () => {
  const { w, session } = setup();
  w.now = new Date(w.now.getTime() + 2 * 3600_000);
  const r = await staffChangePassword(w.changeDeps(), { token: session.token, currentPassword: "Temp#1234", newPassword: "NewPass#99" });
  assert.equal(r.result, "temp_expired");
});

test("no session means unauthorized", async () => {
  const { w } = setup();
  assert.equal((await staffChangePassword(w.changeDeps(), { token: "", currentPassword: "a", newPassword: "b" })).result, "unauthorized");
  assert.equal((await staffChangePassword(w.changeDeps(), { token: "bogus", currentPassword: "a", newPassword: "NewPass#99" })).result, "unauthorized");
});

test("race: a reset that lands after the current password was checked wins", async () => {
  const { w, user, session, adminSession } = setup();
  let resetResult: Awaited<ReturnType<typeof adminResetPassword>> | undefined;
  const deps = w.changeDeps({
    afterVerify: async () => {
      // The change holds the lock, so the reset first finds it busy...
      resetResult = await adminResetPassword(w.resetDeps(), { token: adminSession.token, requestId: "11111111-1111-4111-8111-111111111111", userId: user.user_id });
      assert.equal(resetResult.result, "busy");
      // ...then the change stalls past the 30-second lock and the reset goes through.
      w.now = new Date(w.now.getTime() + 31_000);
      resetResult = await adminResetPassword(w.resetDeps(), { token: adminSession.token, requestId: "22222222-2222-4222-8222-222222222222", userId: user.user_id });
      assert.equal(resetResult.result, "ok");
    },
  });
  const r = await staffChangePassword(deps, { token: session.token, currentPassword: "Temp#1234", newPassword: "NewPass#99" });
  assert.equal(r.result, "reset_by_admin");
  const u = w.users.get(user.user_id)!;
  assert.equal(u.must_change_password, true, "the reset's flag stays on");
  assert.ok(resetResult && "temporary_password" in resetResult);
  assert.equal(u.password, resetResult.temporary_password, "the reset's temporary password stays");
});

test("race: a reset between the window check and completion still keeps its flag", async () => {
  const { w, user, session } = setup();
  const deps = w.changeDeps();
  const setPassword = deps.setPassword;
  deps.setPassword = async (id, p) => {
    const ok = await setPassword(id, p);
    // A reset (version raised) commits while the Auth call is in flight.
    w.users.get(id)!.password_version += 1;
    return ok;
  };
  const r = await staffChangePassword(deps, { token: session.token, currentPassword: "Temp#1234", newPassword: "NewPass#99" });
  assert.equal(r.result, "reset_by_admin");
  assert.equal(w.users.get(user.user_id)!.must_change_password, true);
});

test("a second change at the same time is told to wait", async () => {
  const { w, user, session } = setup();
  w.locks.set(user.user_id, { holder: "someone", expires: w.now.getTime() + 10_000 });
  const r = await staffChangePassword(w.changeDeps(), { token: session.token, currentPassword: "Temp#1234", newPassword: "NewPass#99" });
  assert.equal(r.result, "busy");
  assert.equal(w.locks.get(user.user_id)?.holder, "someone");
});
