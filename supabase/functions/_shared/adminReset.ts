import type { AdminDeps } from "./adminRequests.ts";
import { UUID_PATTERN } from "./http.ts";

export type AdminResetResult =
  | { result: "ok"; temporary_password: string; expires_in_hours: 72 }
  | { result: "invalid_request" | "unauthorized" | "forbidden" | "not_found" | "self_reset" | "busy" | "request_id_reused" | "failed" };

export type AdminResetDeps = AdminDeps & {
  userExists(userId: string): Promise<boolean>;
  newHolder(): string;
  acquireLock(userId: string, holder: string): Promise<boolean>;
  releaseLock(userId: string, holder: string): Promise<void>;
  beginReset(actor: string, userId: string): Promise<void>;
  setPassword(userId: string, password: string): Promise<boolean>;
  revokeAllSessions(userId: string): Promise<void>;
  wait(ms: number): Promise<void>;
};

const LOCK_TRIES = 5;

/**
 * admin-reset-password (task 1.10). Order:
 *  1. flag on, 72-hour expiry, version raised (data access stops at once);
 *  2. set the temporary password in Supabase Auth;
 *  3. end every session of the account.
 * The temporary password comes from the request id, so a retry after a crash
 * or a lost response repeats the same steps and shows the same password.
 */
export async function adminResetPassword(
  deps: AdminResetDeps,
  input: { token: string; requestId: unknown; userId: unknown },
): Promise<AdminResetResult> {
  const requestId = typeof input.requestId === "string" ? input.requestId : "";
  const userId = typeof input.userId === "string" ? input.userId : "";
  if (!UUID_PATTERN.test(requestId) || !UUID_PATTERN.test(userId)) return { result: "invalid_request" };

  const caller = await deps.callerAdmin(input.token);
  if (caller === "unauthorized" || caller === "forbidden") return { result: caller };
  // Admins change their own password from Settings, which keeps their session.
  if (caller.userId === userId) return { result: "self_reset" };

  const request = await deps.beginRequest(caller.userId, requestId, "admin_reset_password", await deps.hash(userId), userId, {});
  if (request === "request_id_reused") return { result: request };
  const temporary = await deps.temporaryPassword(requestId);
  if (request.state === "done") return { result: "ok", temporary_password: temporary, expires_in_hours: 72 };

  if (!(await deps.userExists(userId))) return { result: "not_found" };

  // A password change in progress holds the lock for a few seconds at most.
  const holder = deps.newHolder();
  let locked = false;
  for (let i = 0; i < LOCK_TRIES && !locked; i += 1) {
    locked = await deps.acquireLock(userId, holder);
    if (!locked) await deps.wait(1000);
  }
  if (!locked) return { result: "busy" };

  try {
    await deps.beginReset(caller.userId, userId);
    if (!(await deps.setPassword(userId, temporary))) return { result: "failed" };
    await deps.revokeAllSessions(userId);
    await deps.finishRequest(caller.userId, requestId, { user_id: userId });
    return { result: "ok", temporary_password: temporary, expires_in_hours: 72 };
  } finally {
    await deps.releaseLock(userId, holder);
  }
}
