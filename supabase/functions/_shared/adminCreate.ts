import type { AdminDeps } from "./adminRequests.ts";
import { UUID_PATTERN } from "./http.ts";
import { normalizeUsername, type Role, ROLES, USERNAME_PATTERN } from "./types.ts";

export type AdminCreateResult =
  | { result: "ok"; user_id: string; username: string; temporary_password: string; expires_in_hours: 72 }
  | { result: "invalid_request" | "unauthorized" | "forbidden" | "username_taken" | "request_id_reused" | "failed" }
  | { result: "invalid_field"; field: "username" | "full_name" | "role" | "contact_email" };

export type AdminCreateDeps = AdminDeps & {
  usernameAvailable(username: string, exceptRequest: string): Promise<boolean>;
  findAuthUser(email: string): Promise<string | null>;
  createAuthUser(input: { email: string; password: string; username: string; fullName: string }): Promise<{ userId: string } | "exists" | "failed">;
  setPassword(userId: string, password: string): Promise<boolean>;
  setRequestTarget(actor: string, requestId: string, userId: string): Promise<void>;
  finishCreate(input: { actor: string; requestId: string; userId: string; username: string; fullName: string; role: Role; contactEmail: string | null }): Promise<"ok" | "username_taken">;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Staff sign in by username; the Auth email is an internal address nobody receives mail at. */
export function staffAuthEmail(requestId: string): string {
  return `${requestId.toLowerCase()}@staff.meah.invalid`;
}

/**
 * admin-create-user (task 1.11). Creates a username account with a temporary
 * password the admin hands over in person. Safe to retry with the same
 * request id: the Auth email and password both come from it.
 */
export async function adminCreateUser(
  deps: AdminCreateDeps,
  input: { token: string; requestId: unknown; username: unknown; fullName: unknown; role: unknown; contactEmail: unknown },
): Promise<AdminCreateResult> {
  const requestId = typeof input.requestId === "string" ? input.requestId.toLowerCase() : "";
  if (!UUID_PATTERN.test(requestId)) return { result: "invalid_request" };
  const username = normalizeUsername(input.username);
  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  const role = input.role as Role;
  const contactEmail = typeof input.contactEmail === "string" && input.contactEmail.trim() ? input.contactEmail.trim().toLowerCase() : null;
  if (!USERNAME_PATTERN.test(username)) return { result: "invalid_field", field: "username" };
  if (!fullName || fullName.length > 120) return { result: "invalid_field", field: "full_name" };
  if (!ROLES.includes(role)) return { result: "invalid_field", field: "role" };
  if (contactEmail && !EMAIL_PATTERN.test(contactEmail)) return { result: "invalid_field", field: "contact_email" };

  const caller = await deps.callerAdmin(input.token);
  if (caller === "unauthorized" || caller === "forbidden") return { result: caller };

  const argsHash = await deps.hash(JSON.stringify([username, fullName, role, contactEmail]));
  const request = await deps.beginRequest(caller.userId, requestId, "admin_create_user", argsHash, null, { username });
  if (request === "request_id_reused") return { result: request };
  const temporary = await deps.temporaryPassword(requestId);

  if (request.state === "done") {
    const done = request.result ?? {};
    if (done.error === "username_taken") return { result: "username_taken" };
    return { result: "ok", user_id: String(done.user_id), username, temporary_password: temporary, expires_in_hours: 72 };
  }

  const email = staffAuthEmail(requestId);
  let userId = request.target_user_id ?? (await deps.findAuthUser(email));

  if (!userId) {
    if (!(await deps.usernameAvailable(username, requestId))) {
      await deps.finishRequest(caller.userId, requestId, { error: "username_taken" });
      return { result: "username_taken" };
    }
    const created = await deps.createAuthUser({ email, password: temporary, username, fullName });
    if (created === "exists") userId = await deps.findAuthUser(email);
    else if (created !== "failed") userId = created.userId;
    if (!userId) return { result: "failed" };
  } else if (!(await deps.setPassword(userId, temporary))) {
    // An earlier attempt made the Auth user; make sure its password is this request's one.
    return { result: "failed" };
  }
  await deps.setRequestTarget(caller.userId, requestId, userId);

  const finished = await deps.finishCreate({ actor: caller.userId, requestId, userId, username, fullName, role, contactEmail });
  if (finished === "username_taken") {
    // Only possible if the name was given to someone else in between; the
    // Auth user exists but its profile stays inactive with a placeholder name.
    await deps.finishRequest(caller.userId, requestId, { error: "username_taken", user_id: userId });
    return { result: "username_taken" };
  }
  await deps.finishRequest(caller.userId, requestId, { user_id: userId });
  return { result: "ok", user_id: userId, username, temporary_password: temporary, expires_in_hours: 72 };
}
