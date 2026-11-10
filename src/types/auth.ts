import type { Session, User } from "@supabase/supabase-js";

export const PROFILE_ROLES = [
  "administrator",
  "administrative_staff",
  "fulfillment_staff",
  "delivery_staff",
] as const;

export type ProfileRole = (typeof PROFILE_ROLES)[number];
export type AccountStatus = "active" | "inactive";

export type Profile = {
  id: string;
  full_name: string | null;
  email: string;
  role: ProfileRole;
  status: AccountStatus;
  username: string | null;
  must_change_password: boolean;
  must_change_reason: "temporary_password" | "policy_upgrade" | null;
  temp_password_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AuthState = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  initialized: boolean;
  error: string | null;
};
