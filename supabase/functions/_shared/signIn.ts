import { type Account, type AuthSession, type PasswordCheck, normalizeUsername, temporaryPasswordExpired, USERNAME_PATTERN } from "./types.ts";

export type SignInResult =
  | { result: "ok" | "must_change"; session: AuthSession; must_change_reason: Account["must_change_reason"]; full_name: string | null; role: Account["role"] }
  | { result: "invalid" | "deactivated" | "temp_expired" | "invalid_request" }
  | { result: "locked"; locked_until: string | null };

export type SignInDeps = {
  lookupByUsername(username: string): Promise<Account | null>;
  lookupById(userId: string): Promise<Account | null>;
  reserveAttempt(key: string): Promise<{ allowed: boolean; lockedUntil: string | null }>;
  recordResult(key: string, success: boolean, info: { userId?: string; username: string; ip: string; result: string }): Promise<void>;
  checkPassword(email: string, password: string): Promise<PasswordCheck>;
  revokeSession(accessToken: string): Promise<void>;
  now(): Date;
};

/**
 * staff-sign-in (task 1.8). Order matters:
 *  1. count the attempt before any password check (lockout, D4);
 *  2. check the password with Supabase Auth;
 *  3. read the account again, so a reset or deactivation that happened during
 *     the sign-in is reported instead of a plain success.
 * Unknown usernames and wrong passwords get the same answer. "Deactivated" and
 * "temporary password expired" are only said after a correct password.
 */
export async function staffSignIn(deps: SignInDeps, input: { username: unknown; password: unknown; ip: string }): Promise<SignInResult> {
  const username = normalizeUsername(input.username);
  const password = typeof input.password === "string" ? input.password : "";
  if (!username || !password) return { result: "invalid_request" };

  const account = USERNAME_PATTERN.test(username) ? await deps.lookupByUsername(username) : null;
  const key = account ? `user:${account.user_id}` : `ip:${input.ip}`;

  const reservation = await deps.reserveAttempt(key);
  if (!reservation.allowed) return { result: "locked", locked_until: reservation.lockedUntil };

  if (!account) {
    await deps.recordResult(key, false, { username, ip: input.ip, result: "unknown_user" });
    return { result: "invalid" };
  }

  const check = await deps.checkPassword(account.email, password);
  if (!check.ok) {
    await deps.recordResult(key, false, { userId: account.user_id, username, ip: input.ip, result: check.reason });
    return { result: "invalid" };
  }
  await deps.recordResult(key, true, { userId: account.user_id, username, ip: input.ip, result: "ok" });

  const current = await deps.lookupById(account.user_id);
  if (!current || current.status !== "active") {
    await deps.revokeSession(check.session.access_token);
    return { result: "deactivated" };
  }
  if (temporaryPasswordExpired(current, deps.now())) {
    await deps.revokeSession(check.session.access_token);
    return { result: "temp_expired" };
  }

  return {
    result: current.must_change_password ? "must_change" : "ok",
    session: check.session,
    must_change_reason: current.must_change_reason,
    full_name: current.full_name,
    role: current.role,
  };
}
