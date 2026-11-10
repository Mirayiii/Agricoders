// Creates one sign-in account for each role on a LOCAL Supabase (supabase start).
// Safe to run more than once: existing accounts are updated, nothing is deleted.
//
// Usage (PowerShell):
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<the Secret / service_role key from: npx supabase status>"
//   node scripts/local/create-test-accounts.mjs
//
// It refuses any address that is not this computer or a home network address,
// so it can't touch a hosted project by mistake. The passwords below are for
// local testing only and must never be used on a hosted project.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const host = new URL(url).hostname;
const local = host === "localhost" || host === "127.0.0.1" || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
if (!local || host.endsWith("supabase.co")) {
  console.error(`Refusing to run: ${url} is not a local Supabase. This script only creates local test accounts.`);
  process.exit(2);
}
if (!key) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY first (the Secret or service_role key shown by: npx supabase status).");
  process.exit(2);
}

export const PASSWORD = "LocalTest#2026";
export const ACCOUNTS = [
  { username: "admin.test", fullName: "Test Administrator", role: "administrator" },
  { username: "office.test", fullName: "Test Office Staff", role: "administrative_staff" },
  { username: "packer.test", fullName: "Test Purchasing Staff", role: "fulfillment_staff" },
  { username: "driver.test", fullName: "Test Delivery Staff", role: "delivery_staff" },
];

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

for (const account of ACCOUNTS) {
  const email = `${account.username}@local.meah.invalid`;
  let { data: profile } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (!profile) {
    const { data, error } = await db.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: account.fullName },
    });
    if (error) throw new Error(`${account.username}: ${error.message}`);
    profile = { id: data.user.id };
  } else {
    const { error } = await db.auth.admin.updateUserById(profile.id, { password: PASSWORD });
    if (error) throw new Error(`${account.username}: ${error.message}`);
  }
  const { error } = await db.from("profiles").update({
    username: account.username, full_name: account.fullName, role: account.role,
    status: "active", must_change_password: false, must_change_reason: null, temp_password_expires_at: null,
  }).eq("id", profile.id);
  if (error) throw new Error(`${account.username}: ${error.message}`);
  console.log(`Ready: ${account.username} (${account.role})`);
}
console.log(`\nAll four accounts use the password ${PASSWORD} (local testing only).`);
