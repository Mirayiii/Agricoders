import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/services/supabase";
import type { ProfileRole } from "@/types/auth";

/** Calls one of the account Edge Functions and returns its `{ result, ... }` body. */
export async function callAccountFunction<T extends { result: string }>(name: string, body: Record<string, unknown>): Promise<T | { result: "network_error" }> {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (!error) return data as T;
    if (error instanceof FunctionsHttpError) {
      const parsed = await (error.context as Response).json().catch(() => null);
      if (parsed && typeof parsed.result === "string") return parsed as T;
    }
    return { result: "network_error" };
  } catch {
    return { result: "network_error" };
  }
}

export type SignInResponse =
  | { result: "ok" | "must_change"; session: { access_token: string; refresh_token: string }; full_name: string | null; role: ProfileRole; must_change_reason: string | null }
  | { result: "invalid" | "deactivated" | "temp_expired" | "invalid_request" | "error" | "network_error" }
  | { result: "locked"; locked_until: string | null };

export type ChangePasswordResponse =
  | { result: "ok" | "invalid_request" | "unauthorized" | "busy" | "invalid_current" | "deactivated" | "temp_expired" | "same_password" | "reset_by_admin" | "failed" | "error" | "network_error" }
  | { result: "weak_password"; failed_rules: string[] }
  | { result: "locked"; locked_until: string | null };

/** Minutes left on a lock, rounded up, at least 1. */
export function minutesUntil(iso: string | null, now = Date.now()): number {
  if (!iso) return 15;
  return Math.max(1, Math.ceil((new Date(iso).getTime() - now) / 60_000));
}

export type AuthMessage = { title: string; message: string };

export function signInMessage(response: SignInResponse): AuthMessage | null {
  switch (response.result) {
    case "ok":
    case "must_change":
      return null;
    case "invalid":
    case "invalid_request":
      return { title: "Incorrect username or password.", message: "Check your details and try again. 5 failed attempts locks the account for 15 minutes." };
    case "locked": {
      const minutes = minutesUntil(response.locked_until);
      return { title: "Account locked", message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask your administrator to unlock it.` };
    }
    case "deactivated":
      return { title: "Account deactivated", message: "Ask your administrator to reactivate your account." };
    case "temp_expired":
      return { title: "Temporary password expired", message: "Ask your administrator for a new temporary password." };
    case "network_error":
      return { title: "Can't connect", message: "Check your internet connection and try again." };
    default:
      return { title: "Something went wrong", message: "We could not sign you in. Try again in a moment." };
  }
}

export function changePasswordMessage(response: ChangePasswordResponse): AuthMessage | null {
  switch (response.result) {
    case "ok":
      return null;
    case "invalid_current":
      return { title: "Current password is incorrect", message: "Check it and try again. 5 failed attempts locks the account for 15 minutes." };
    case "weak_password":
      return { title: "Password too weak", message: "Choose a password that meets every rule below." };
    case "same_password":
      return { title: "Choose a new password", message: "The new password must be different from the current one." };
    case "reset_by_admin":
      return { title: "Password was reset", message: "Your password was reset by an administrator. Sign in with the new temporary password." };
    case "temp_expired":
      return { title: "Temporary password expired", message: "Ask your administrator for a new temporary password." };
    case "deactivated":
      return { title: "Account deactivated", message: "Ask your administrator to reactivate your account." };
    case "locked": {
      const minutes = minutesUntil(response.locked_until);
      return { title: "Account locked", message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask your administrator to unlock it.` };
    }
    case "busy":
      return { title: "Please wait", message: "Another password change is in progress. Try again in a few seconds." };
    case "unauthorized":
      return { title: "Signed out", message: "Your session ended. Sign in again to continue." };
    case "network_error":
      return { title: "Can't connect", message: "Check your internet connection and try again." };
    default:
      return { title: "Something went wrong", message: "Your password was not changed. Try again in a moment." };
  }
}

/** Results after which the person must sign in again. */
export const CHANGE_RESULTS_THAT_SIGN_OUT = new Set(["reset_by_admin", "temp_expired", "deactivated", "unauthorized"]);
