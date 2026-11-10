// Phase 1 spike (task 1.0): checks real Supabase Auth behaviour on a TEST
// project. It creates accounts named spike.* and deletes them at the end.
// NEVER run it against production.
//
//   SUPABASE_URL=https://<test-ref>.supabase.co \
//   SUPABASE_ANON_KEY=<test anon or publishable key> \
//   SUPABASE_SERVICE_ROLE_KEY=<test service role key> \
//   node supabase/tests/spike/spike.mjs --test-project <test-ref>
//
// Needs: the migrations and the four Edge Functions deployed to that project,
// and one active administrator whose username/password are given as
// SPIKE_ADMIN_USERNAME / SPIKE_ADMIN_PASSWORD.
import { Buffer } from "node:buffer";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const env = process.env;
const url = env.SUPABASE_URL;
const anonKey = env.SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const SPIKE_ADMIN_USERNAME = env.SPIKE_ADMIN_USERNAME;
const SPIKE_ADMIN_PASSWORD = env.SPIKE_ADMIN_PASSWORD;
const refArg = process.argv[process.argv.indexOf("--test-project") + 1];
if (!process.argv.includes("--test-project") || !refArg || !url?.startsWith(`https://${refArg}.`)) {
  console.error("Refusing to run: pass --test-project <ref> matching SUPABASE_URL. Use a separate test project, never production.");
  process.exit(2);
}
if (!anonKey || !serviceKey || !SPIKE_ADMIN_USERNAME || !SPIKE_ADMIN_PASSWORD) {
  console.error("Set SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SPIKE_ADMIN_USERNAME and SPIKE_ADMIN_PASSWORD.");
  process.exit(2);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceKey, opts);
const anon = () => createClient(url, anonKey, opts);
const asToken = (token) => createClient(url, anonKey, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } });
const fn = async (name, body, token) => {
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${token ?? anonKey}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const uuid = () => crypto.randomUUID();
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok || !detail ? "" : ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})`}`);
  if (!ok) failures += 1;
};
const created = [];

async function main() {
  // 0. Admin signs in through the function.
  const admin = await fn("staff-sign-in", { username: SPIKE_ADMIN_USERNAME, password: SPIKE_ADMIN_PASSWORD });
  check(admin.body?.result === "ok", "admin signs in by username through staff-sign-in", admin.body);
  if (admin.body?.result !== "ok") return;
  const adminToken = admin.body.session.access_token;

  // 1. Create a staff account: .invalid email accepted, temporary password returned.
  const suffix = Math.random().toString(36).slice(2, 7);
  const username = `spike.${suffix}`;
  const reqId = uuid();
  const create = await fn("admin-create-user", { request_id: reqId, username, full_name: "Spike Test", role: "delivery_staff" }, adminToken);
  check(create.body?.result === "ok", "admin-create-user accepts a <request id>@staff.meah.invalid account", create.body);
  if (create.body?.result !== "ok") return;
  created.push(create.body.user_id);
  const temp = create.body.temporary_password;
  const again = await fn("admin-create-user", { request_id: reqId, username, full_name: "Spike Test", role: "delivery_staff" }, adminToken);
  check(again.body?.user_id === create.body.user_id && again.body?.temporary_password === temp, "retrying the same create returns the same account and password");

  // 2. Flagged account: signs in, but gets no data.
  const first = await fn("staff-sign-in", { username, password: temp });
  check(first.body?.result === "must_change", "temporary password signs in as must_change", first.body);
  const flagged = asToken(first.body.session.access_token);
  const { data: rows, error: rowsError } = await flagged.from("orders").select("id").limit(1);
  check(!rowsError && rows.length === 0, "flagged account reads zero orders");
  const { error: flagUpdate } = await flagged.from("profiles").update({ must_change_password: false }).eq("id", create.body.user_id);
  check(Boolean(flagUpdate), "flagged account cannot clear its own flag through the API");

  // 3. Password change clears the flag and keeps this session.
  const newPassword = `Spike#${suffix}9A`;
  const change = await fn("staff-change-password", { current_password: temp, new_password: newPassword }, first.body.session.access_token);
  check(change.body?.result === "ok", "staff-change-password succeeds", change.body);

  // 4. Lockout: wrong password is refused, 6th try locked even with the right password.
  for (let i = 0; i < 5; i += 1) await fn("staff-sign-in", { username, password: "wrong" });
  const locked = await fn("staff-sign-in", { username, password: newPassword });
  check(locked.body?.result === "locked", "6th attempt is locked, even with the right password", locked.body);
  const { error: unlockError } = await asToken(adminToken).rpc("admin_unlock_user", { p_user_id: create.body.user_id });
  check(!unlockError, "admin unlock works");

  // 5. Parallel attempts: 10 at once, at most 5 reach Supabase Auth.
  const burst = await Promise.all(Array.from({ length: 10 }, () => fn("staff-sign-in", { username, password: "wrong" })));
  const refused = burst.filter((r) => r.body?.result === "locked").length;
  check(refused === 5, "10 parallel wrong attempts: exactly 5 refused as locked", { refused });
  await asToken(adminToken).rpc("admin_unlock_user", { p_user_id: create.body.user_id });

  // 6. Direct Auth sign-in with the internal email skips our counter (documented limit D0).
  const email = `${reqId}@staff.meah.invalid`;
  const direct = await anon().auth.signInWithPassword({ email, password: "wrong" });
  check(Boolean(direct.error), "direct sign-in with a wrong password is refused by Supabase", direct.error?.message);
  const counter = await fn("staff-sign-in", { username, password: newPassword });
  check(counter.body?.result === "ok", "direct attempts did not count toward our lockout (documented limit)", counter.body);

  // 7. admin.signOut(token, "local") ends only that session.
  const s1 = await fn("staff-sign-in", { username, password: newPassword });
  const s2 = await fn("staff-sign-in", { username, password: newPassword });
  await service.auth.admin.signOut(s1.body.session.access_token, "local");
  const r1 = await anon().auth.refreshSession({ refresh_token: s1.body.session.refresh_token });
  const r2 = await anon().auth.refreshSession({ refresh_token: s2.body.session.refresh_token });
  check(Boolean(r1.error) && !r2.error, "admin.signOut(token, 'local') ends only that session", { s1: r1.error?.message, s2: r2.error?.message });

  // 8. Reset during a session: data stops at once, the session is ended.
  const live = r2.data.session;
  const reset = await fn("admin-reset-password", { request_id: uuid(), user_id: create.body.user_id }, adminToken);
  check(reset.body?.result === "ok", "admin-reset-password succeeds", reset.body);
  const { data: afterReset } = await asToken(live.access_token).from("deliveries").select("id").limit(1);
  check((afterReset ?? []).length === 0, "after a reset, the old session reads no data");
  const refreshAfterReset = await anon().auth.refreshSession({ refresh_token: live.refresh_token });
  check(Boolean(refreshAfterReset.error), "after a reset, the old session cannot refresh");

  // 9. Wrong password vs deactivated: the wrong password still says "invalid".
  await asToken(adminToken).from("profiles").update({ status: "inactive" }).eq("id", create.body.user_id);
  const wrongWhileInactive = await fn("staff-sign-in", { username, password: "wrong" });
  check(wrongWhileInactive.body?.result === "invalid", "deactivated account + wrong password says invalid (no leak)", wrongWhileInactive.body);
  const rightWhileInactive = await fn("staff-sign-in", { username, password: reset.body.temporary_password });
  check(rightWhileInactive.body?.result === "deactivated", "deactivated account + right password says deactivated", rightWhileInactive.body);

  // 10. Token lifetime (D7, after task 1.6 is applied on this project).
  const jwt = JSON.parse(Buffer.from(admin.body.session.access_token.split(".")[1], "base64url").toString());
  check(jwt.exp - jwt.iat === 900, "access tokens last 900 seconds (needs task 1.6 settings)", { seconds: jwt.exp - jwt.iat });
}

try {
  await main();
} finally {
  for (const id of created) await service.auth.admin.deleteUser(id);
  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exitCode = failures ? 1 : 0;
}
