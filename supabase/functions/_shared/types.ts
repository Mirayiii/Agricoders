export type Role = "administrator" | "administrative_staff" | "fulfillment_staff" | "delivery_staff";
export const ROLES: Role[] = ["administrator", "administrative_staff", "fulfillment_staff", "delivery_staff"];

export type Account = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: Role;
  status: "active" | "inactive";
  must_change_password: boolean;
  must_change_reason: "temporary_password" | "policy_upgrade" | null;
  temp_password_expires_at: string | null;
  password_version: number;
};

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
};

export type PasswordCheck =
  | { ok: true; session: AuthSession }
  | { ok: false; reason: "invalid" | "error" };

export const USERNAME_PATTERN = /^[a-z][a-z0-9._]{2,29}$/;

export function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** D6: only admin-issued temporary passwords expire; D11 policy upgrades never do. */
export function temporaryPasswordExpired(account: Account, now: Date): boolean {
  return account.must_change_password
    && account.must_change_reason === "temporary_password"
    && account.temp_password_expires_at !== null
    && new Date(account.temp_password_expires_at).getTime() <= now.getTime();
}
