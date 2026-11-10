import assert from "node:assert/strict";
import { test } from "node:test";

import { staffSignIn } from "../_shared/signIn.ts";
import { FakeWorld } from "./fakeWorld.ts";

const ip = "203.0.113.5";

test("signs in with a username in any case and returns the session", async () => {
  const w = new FakeWorld();
  w.addUser({ username: "maria", password: "Secret#123", full_name: "Maria Cruz" });
  const r = await staffSignIn(w.signInDeps(), { username: "  MaRia ", password: "Secret#123", ip });
  assert.equal(r.result, "ok");
  assert.ok("session" in r && r.session.access_token);
  assert.equal("full_name" in r && r.full_name, "Maria Cruz");
});

test("unknown username and wrong password give the same answer", async () => {
  const w = new FakeWorld();
  w.addUser({ username: "maria", password: "Secret#123" });
  const a = await staffSignIn(w.signInDeps(), { username: "nobody", password: "x", ip });
  const b = await staffSignIn(w.signInDeps(), { username: "maria", password: "wrong", ip });
  assert.deepEqual(a, { result: "invalid" });
  assert.deepEqual(b, { result: "invalid" });
});

test("missing fields are refused before any attempt is counted", async () => {
  const w = new FakeWorld();
  assert.deepEqual(await staffSignIn(w.signInDeps(), { username: "maria", password: "", ip }), { result: "invalid_request" });
  assert.equal(w.guard.size, 0);
});

test("the sixth try is locked without checking the password, even if correct (D0, D4)", async () => {
  const w = new FakeWorld();
  w.addUser({ username: "maria", password: "Secret#123" });
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await staffSignIn(w.signInDeps(), { username: "maria", password: "bad", ip })).result, "invalid");
  }
  const checks = w.passwordChecks;
  const r = await staffSignIn(w.signInDeps(), { username: "maria", password: "Secret#123", ip });
  assert.equal(r.result, "locked");
  assert.equal(w.passwordChecks, checks);
  // Unlocks by itself after 15 minutes.
  w.now = new Date(w.now.getTime() + 15 * 60_000 + 1000);
  assert.equal((await staffSignIn(w.signInDeps(), { username: "maria", password: "Secret#123", ip })).result, "ok");
});

test("a success resets the failure count", async () => {
  const w = new FakeWorld();
  w.addUser({ username: "maria", password: "Secret#123" });
  for (let i = 0; i < 4; i += 1) await staffSignIn(w.signInDeps(), { username: "maria", password: "bad", ip });
  assert.equal((await staffSignIn(w.signInDeps(), { username: "maria", password: "Secret#123", ip })).result, "ok");
  for (let i = 0; i < 4; i += 1) await staffSignIn(w.signInDeps(), { username: "maria", password: "bad", ip });
  assert.equal((await staffSignIn(w.signInDeps(), { username: "maria", password: "Secret#123", ip })).result, "ok");
});

test("deactivated is only said after a correct password, and the new session is ended", async () => {
  const w = new FakeWorld();
  const u = w.addUser({ username: "maria", password: "Secret#123", status: "inactive" });
  assert.equal((await staffSignIn(w.signInDeps(), { username: "maria", password: "bad", ip })).result, "invalid");
  assert.equal((await staffSignIn(w.signInDeps(), { username: "maria", password: "Secret#123", ip })).result, "deactivated");
  assert.equal(w.sessionsOf(u.user_id).length, 0);
});

test("a temporary password expires after 72 hours (D6); a policy upgrade never does (D11)", async () => {
  const w = new FakeWorld();
  const past = new Date(w.now.getTime() - 1000).toISOString();
  const t = w.addUser({ username: "temp.user", password: "Temp#1234", must_change_password: true, must_change_reason: "temporary_password", temp_password_expires_at: past });
  w.addUser({ username: "old.user", password: "oldpassword", must_change_password: true, must_change_reason: "policy_upgrade" });
  assert.equal((await staffSignIn(w.signInDeps(), { username: "temp.user", password: "Temp#1234", ip })).result, "temp_expired");
  assert.equal(w.sessionsOf(t.user_id).length, 0);
  const r = await staffSignIn(w.signInDeps(), { username: "old.user", password: "oldpassword", ip });
  assert.equal(r.result, "must_change");
  assert.equal("must_change_reason" in r && r.must_change_reason, "policy_upgrade");
});

test("a deactivation that lands during sign-in is reported, not hidden", async () => {
  const w = new FakeWorld();
  const u = w.addUser({ username: "maria", password: "Secret#123" });
  const deps = w.signInDeps();
  const check = deps.checkPassword;
  deps.checkPassword = async (e, p) => { const r = await check(e, p); w.users.get(u.user_id)!.status = "inactive"; return r; };
  assert.equal((await staffSignIn(deps, { username: "maria", password: "Secret#123", ip })).result, "deactivated");
  assert.equal(w.sessionsOf(u.user_id).length, 0);
});
