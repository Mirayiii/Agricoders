import { supabase } from "@/services/supabase";
import { callAccountFunction } from "@/features/auth/staffAuthApi";
import type { ProfileRole } from "@/types/auth";

/** An id for one admin action. Retrying with the same id never repeats the action. */
export { newClientRequestId as newRequestId } from "@/services/data";

export const USERNAME_PATTERN = /^[a-z][a-z0-9._]{2,29}$/;

/** D2 username from a full name, for example "Maria Dela Cruz" -> "maria.delacruz". */
export function suggestUsername(fullName: string): string {
  const parts = fullName
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const base = (parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("")}` : parts[0]).replace(/^[^a-z]+/, "");
  return base.slice(0, 30);
}

export function usernameError(value: string): string | undefined {
  if (!value) return undefined;
  if (value.length < 3 || value.length > 30) return "Use 3 to 30 characters.";
  if (!/^[a-z]/.test(value)) return "Start with a letter.";
  if (!USERNAME_PATTERN.test(value)) return "Use only lowercase letters, numbers, dots and underscores.";
  return undefined;
}

export type TemporaryPassword = { username: string; password: string };

type CreateResponse =
  | { result: "ok"; user_id: string; username: string; temporary_password: string }
  | { result: "invalid_field"; field: string }
  | { result: string };

export async function createStaffUser(requestId: string, input: { fullName: string; username: string; role: ProfileRole; contactEmail: string }): Promise<{ ok: true; temp: TemporaryPassword } | { ok: false; error: string }> {
  const response = await callAccountFunction<CreateResponse>("admin-create-user", {
    request_id: requestId,
    full_name: input.fullName,
    username: input.username,
    role: input.role,
    contact_email: input.contactEmail,
  });
  if (response.result === "ok" && "temporary_password" in response) {
    return { ok: true, temp: { username: response.username, password: response.temporary_password } };
  }
  const messages: Record<string, string> = {
    username_taken: "That username is already used, or was used in the last 30 days. Choose another.",
    invalid_field: "Check the details and try again.",
    forbidden: "Only administrators can add users.",
    unauthorized: "Your session ended. Sign in again.",
    network_error: "Can't connect. Check your internet connection and try again.",
  };
  if (response.result === "invalid_field" && "field" in response) {
    const field = { username: "username", full_name: "full name", role: "role", contact_email: "contact email" }[response.field] ?? "details";
    return { ok: false, error: `Check the ${field} and try again.` };
  }
  return { ok: false, error: messages[response.result] ?? "Unable to create this user. Try again." };
}

export async function resetStaffPassword(requestId: string, userId: string): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  const response = await callAccountFunction<{ result: string; temporary_password?: string }>("admin-reset-password", {
    request_id: requestId,
    user_id: userId,
  });
  if (response.result === "ok" && "temporary_password" in response && response.temporary_password) {
    return { ok: true, password: response.temporary_password };
  }
  const messages: Record<string, string> = {
    busy: "This person is changing their password right now. Try again in a few seconds.",
    self_reset: "Change your own password from Settings.",
    not_found: "This account no longer exists.",
    forbidden: "Only administrators can reset passwords.",
    network_error: "Can't connect. Check your internet connection and try again.",
  };
  return { ok: false, error: messages[response.result] ?? "Unable to reset the password. Try again." };
}

export async function unlockStaffUser(userId: string): Promise<string | null> {
  const { error } = await supabase.rpc("admin_unlock_user", { p_user_id: userId });
  return error ? "Unable to unlock this account. Try again." : null;
}

export async function changeStaffUsername(userId: string, username: string): Promise<string | null> {
  const { error } = await supabase.rpc("admin_change_username", { p_user_id: userId, p_new_username: username });
  if (!error) return null;
  return error.message.includes("username_taken")
    ? "That username is already used, or was used in the last 30 days. Choose another."
    : "Unable to change the username. Try again.";
}

/** Accounts locked after 5 failed sign-ins, with when they unlock by themselves. */
export async function loadAccountLocks(): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc("get_account_locks");
  if (error || !Array.isArray(data)) return new Map();
  return new Map((data as { user_id: string; locked_until: string }[]).map((row) => [row.user_id, row.locked_until]));
}
