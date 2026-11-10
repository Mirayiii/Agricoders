import { failedPasswordRules } from "./passwordRules.ts";
import { type Account, type PasswordCheck, temporaryPasswordExpired } from "./types.ts";

export type ChangePasswordResult =
  | { result: "ok" }
  | { result: "invalid_request" | "unauthorized" | "busy" | "invalid_current" | "deactivated" | "temp_expired" | "same_password" | "reset_by_admin" | "failed" }
  | { result: "weak_password"; failed_rules: string[] }
  | { result: "locked"; locked_until: string | null };

export type ChangePasswordDeps = {
  caller(token: string): Promise<{ userId: string; sessionId: string | null } | null>;
  lookupById(userId: string): Promise<Account | null>;
  newHolder(): string;
  acquireLock(userId: string, holder: string): Promise<boolean>;
  releaseLock(userId: string, holder: string): Promise<void>;
  reserveAttempt(key: string): Promise<{ allowed: boolean; lockedUntil: string | null }>;
  recordResult(key: string, success: boolean, info: { userId: string; result: string }): Promise<void>;
  checkPassword(email: string, password: string): Promise<PasswordCheck>;
  revokeSession(accessToken: string): Promise<void>;
  confirmWindow(userId: string, holder: string, notedVersion: number): Promise<boolean>;
  setPassword(userId: string, password: string): Promise<boolean>;
  completeChange(userId: string, notedVersion: number): Promise<boolean>;
  revokeOtherSessions(userId: string, keepSessionId: string | null): Promise<void>;
  now(): Date;
  /** Test-only pause after the current password is verified (race test). */
  afterVerify?(): Promise<void>;
};

/**
 * staff-change-password (task 1.9). The only code that clears
 * must_change_password. A change that started before an admin reset can never
 * clear the reset's flag or overwrite its temporary password:
 *  - it holds the per-account credential lock, so a reset waits;
 *  - it notes password_version when it checks the current password and only
 *    sets the new password, and clears the flag, while that version is unchanged.
 */
export async function staffChangePassword(
  deps: ChangePasswordDeps,
  input: { token: string; currentPassword: unknown; newPassword: unknown },
): Promise<ChangePasswordResult> {
  const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
  const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
  if (!input.token) return { result: "unauthorized" };
  if (!currentPassword || !newPassword) return { result: "invalid_request" };

  const caller = await deps.caller(input.token);
  if (!caller) return { result: "unauthorized" };

  const failed = failedPasswordRules(newPassword);
  if (failed.length) return { result: "weak_password", failed_rules: failed };
  if (newPassword === currentPassword) return { result: "same_password" };

  const holder = deps.newHolder();
  if (!(await deps.acquireLock(caller.userId, holder))) return { result: "busy" };

  try {
    const account = await deps.lookupById(caller.userId);
    if (!account) return { result: "unauthorized" };
    const notedVersion = account.password_version;

    // Guessing the current password here counts toward the same lockout.
    const key = `user:${account.user_id}`;
    const reservation = await deps.reserveAttempt(key);
    if (!reservation.allowed) return { result: "locked", locked_until: reservation.lockedUntil };
    const check = await deps.checkPassword(account.email, currentPassword);
    await deps.recordResult(key, check.ok, { userId: account.user_id, result: check.ok ? "ok" : "invalid_current" });
    if (!check.ok) return { result: "invalid_current" };
    // The check opened a session of its own; it is not needed.
    await deps.revokeSession(check.session.access_token);

    if (account.status !== "active") return { result: "deactivated" };
    if (temporaryPasswordExpired(account, deps.now())) return { result: "temp_expired" };

    await deps.afterVerify?.();

    if (!(await deps.confirmWindow(account.user_id, holder, notedVersion))) return { result: "reset_by_admin" };
    if (!(await deps.setPassword(account.user_id, newPassword))) return { result: "failed" };
    // A crash before this line leaves the flag on: the user is simply asked again.
    if (!(await deps.completeChange(account.user_id, notedVersion))) return { result: "reset_by_admin" };

    await deps.revokeOtherSessions(account.user_id, caller.sessionId);
    return { result: "ok" };
  } finally {
    await deps.releaseLock(caller.userId, holder);
  }
}
