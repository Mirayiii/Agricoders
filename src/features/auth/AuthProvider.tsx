import type { ReactNode } from "react";
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { sessionStorage } from "../../../lib/sessionStorage";
import { isSupabaseConfigured, supabase } from "@/services/supabase";
import type { AuthState, Profile, ProfileRole } from "@/types/auth";
import { activePreviewRole, previewedProfile, type RolePreview } from "./rolePreview";
import { clearNewOrderDraft } from "@/features/orders/new/newOrderDraft";
import {
  type AuthMessage,
  callAccountFunction,
  CHANGE_RESULTS_THAT_SIGN_OUT,
  changePasswordMessage,
  type ChangePasswordResponse,
  signInMessage,
  type SignInResponse,
} from "./staffAuthApi";

export type ChangePasswordOutcome = { ok: true } | { ok: false; message: AuthMessage; signedOut: boolean; failedRules?: string[] };

type AuthContextValue = AuthState & {
  /** Signed in, active, and not required to set a new password: the app is open. */
  isActive: boolean;
  /** Signed in but must choose a new password first (temporary password, or D11). */
  needsPasswordChange: boolean;
  /** Show the Welcome screen once after an interactive sign-in (D9). */
  welcomePending: boolean;
  /** Whether the app still holds the password typed at sign-in (so Set password need not ask again). */
  knowsCurrentPassword: boolean;
  /** Whether a new password is the same as the one typed at sign-in (the "not the temporary password" rule). */
  matchesSignInPassword: (password: string) => boolean;
  signIn: (username: string, password: string, keepSignedIn: boolean) => Promise<AuthMessage | null>;
  changePassword: (newPassword: string, currentPassword?: string) => Promise<ChangePasswordOutcome>;
  finishWelcome: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
  /**
   * The signed-in person's real role. `profile.role` is the previewed role
   * during a role preview, so screens show what that role sees.
   */
  realRole: ProfileRole | null;
  /** The role an administrator is previewing, or null. UI only; the server never sees it. */
  previewRole: ProfileRole | null;
  startRolePreview: (role: ProfileRole) => void;
  endRolePreview: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const PROFILE_COLUMNS = "id, full_name, email, username, role, status, must_change_password, must_change_reason, temp_password_expires_at, created_at, updated_at";

function profileErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "PGRST116") {
    return "Your account has not been provisioned. Please contact an administrator.";
  }
  return "We could not verify your account permissions. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => ({
    session: null,
    user: null,
    profile: null,
    initialized: !isSupabaseConfigured,
    error: isSupabaseConfigured ? null : "Supabase is not configured for this app.",
  }));
  const [welcomePending, setWelcomePending] = useState(false);
  // The password typed at sign-in, kept in memory only until it is replaced.
  const signInPassword = useRef<string | null>(null);
  const [knowsCurrentPassword, setKnowsCurrentPassword] = useState(false);
  // Kept in memory only: restarting the app or signing out ends a preview.
  const [rolePreview, setRolePreview] = useState<RolePreview | null>(null);

  const forgetPassword = useCallback(() => {
    signInPassword.current = null;
    setKnowsCurrentPassword(false);
  }, []);

  const loadProfile = useCallback(async (session: Session): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", session.user.id)
      .single<Profile>();

    if (error) {
      setState((current) => ({ ...current, profile: null, error: profileErrorMessage(error) }));
      return null;
    }
    return data;
  }, []);

  const applySession = useCallback(async (session: Session | null) => {
    if (!session) {
      forgetPassword();
      setWelcomePending(false);
      setState((current) => ({ session: null, user: null, profile: null, initialized: true, error: current.session ? null : current.error }));
      return;
    }

    const profile = await loadProfile(session);
    if (!profile || profile.status !== "active") {
      const message = profile
        ? "Account deactivated. Ask your administrator to reactivate your account."
        : "Your account has not been provisioned. Please contact an administrator.";
      await supabase.auth.signOut({ scope: "local" });
      setState({ session: null, user: null, profile: null, initialized: true, error: message });
      return;
    }

    setState({ session, user: session.user, profile, initialized: true, error: null });
  }, [forgetPassword, loadProfile]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Token refreshes keep the same account; only reload on real changes.
      if (event === "TOKEN_REFRESHED") {
        setState((current) => (current.session ? { ...current, session } : current));
        return;
      }
      void applySession(session);
    });
    return () => listener.subscription.unsubscribe();
  }, [applySession]);

  const signIn = useCallback(async (username: string, password: string, keepSignedIn: boolean) => {
    if (!isSupabaseConfigured) {
      return { title: "App not configured", message: "Supabase is not configured for this app." };
    }

    const response = await callAccountFunction<SignInResponse>("staff-sign-in", { username, password });
    const message = signInMessage(response);
    if (message || !("session" in response)) return message ?? signInMessage({ result: "error" });

    await sessionStorage.setPersistent(keepSignedIn);
    signInPassword.current = password;
    setKnowsCurrentPassword(true);
    setWelcomePending(true);
    const { error } = await supabase.auth.setSession(response.session);
    if (error) {
      forgetPassword();
      setWelcomePending(false);
      return signInMessage({ result: "error" });
    }
    return null;
  }, [forgetPassword]);

  const signOut = useCallback(async () => {
    setRolePreview(null);
    clearNewOrderDraft();
    forgetPassword();
    setWelcomePending(false);
    await supabase.auth.signOut({ scope: "local" });
  }, [forgetPassword]);

  const refreshProfile = useCallback(async () => {
    if (!state.session) return null;
    const profile = await loadProfile(state.session);
    if (profile?.status !== "active") {
      await signOut();
      return null;
    }
    setState((current) => ({ ...current, profile, error: null }));
    return profile;
  }, [loadProfile, signOut, state.session]);

  const changePassword = useCallback(async (newPassword: string, currentPassword?: string): Promise<ChangePasswordOutcome> => {
    const current = currentPassword ?? signInPassword.current;
    if (!current) {
      return { ok: false, signedOut: false, message: { title: "Enter your current password", message: "Type the password you signed in with." } };
    }
    const response = await callAccountFunction<ChangePasswordResponse>("staff-change-password", {
      current_password: current,
      new_password: newPassword,
    });
    if (response.result === "ok") {
      forgetPassword();
      await refreshProfile();
      return { ok: true };
    }
    const message = changePasswordMessage(response) ?? { title: "Something went wrong", message: "Try again in a moment." };
    const signedOut = CHANGE_RESULTS_THAT_SIGN_OUT.has(response.result);
    if (signedOut) {
      await signOut();
      setState((s) => ({ ...s, error: `${message.title} ${message.message}` }));
    }
    return { ok: false, message, signedOut, failedRules: "failed_rules" in response ? response.failed_rules : undefined };
  }, [forgetPassword, refreshProfile, signOut]);

  const finishWelcome = useCallback(() => setWelcomePending(false), []);
  const profileId = state.profile?.id ?? null;
  const startRolePreview = useCallback((role: ProfileRole) => {
    if (profileId) setRolePreview({ userId: profileId, role });
  }, [profileId]);
  const endRolePreview = useCallback(() => setRolePreview(null), []);
  const matchesSignInPassword = useCallback((password: string) => signInPassword.current !== null && password === signInPassword.current, []);

  const value = useMemo<AuthContextValue>(() => {
    const signedIn = Boolean(state.session && state.profile?.status === "active");
    const needsPasswordChange = signedIn && Boolean(state.profile?.must_change_password);
    return {
      ...state,
      profile: previewedProfile(state.profile, rolePreview),
      realRole: state.profile?.role ?? null,
      previewRole: activePreviewRole(state.profile, rolePreview),
      startRolePreview,
      endRolePreview,
      isActive: signedIn && !needsPasswordChange,
      needsPasswordChange,
      welcomePending: signedIn && !needsPasswordChange && welcomePending,
      knowsCurrentPassword,
      matchesSignInPassword,
      signIn,
      changePassword,
      finishWelcome,
      signOut,
      refreshProfile,
    };
  }, [changePassword, endRolePreview, finishWelcome, knowsCurrentPassword, matchesSignInPassword, refreshProfile, rolePreview, signIn, signOut, startRolePreview, state, welcomePending]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthContext };
