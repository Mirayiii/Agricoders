// Real dependencies for the core modules, built on supabase-js. Only the
// index.ts files import this; tests use in-memory fakes instead.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import type { AdminDeps, AdminRequestState } from "./adminRequests.ts";
import { jwtClaim, sha256Hex, temporaryPassword } from "./crypto.ts";
import type { Account, PasswordCheck } from "./types.ts";

export type Env = { url: string; anonKey: string; serviceKey: string };

export function readEnv(): Env | null {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && anonKey && serviceKey ? { url, anonKey, serviceKey } : null;
}

const noSession = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.url, env.serviceKey, noSession);
}

async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

function firstRow<T>(data: T[] | T | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

export function accountDeps(service: SupabaseClient) {
  return {
    lookupByUsername: async (username: string) =>
      firstRow(await rpc<Account[]>(service, "lookup_sign_in_account", { p_username: username })),
    lookupById: async (userId: string) =>
      firstRow(await rpc<Account[]>(service, "lookup_account_by_id", { p_user_id: userId })),
    reserveAttempt: async (key: string) => {
      const row = firstRow(await rpc<{ allowed: boolean; locked_until: string | null }[]>(service, "reserve_login_attempt", { p_key: key }));
      return { allowed: Boolean(row?.allowed), lockedUntil: row?.locked_until ?? null };
    },
    newHolder: () => crypto.randomUUID(),
    acquireLock: (userId: string, holder: string) =>
      rpc<boolean>(service, "acquire_credential_lock", { p_user_id: userId, p_holder: holder, p_operation: "password" }),
    releaseLock: (userId: string, holder: string) =>
      rpc<void>(service, "release_credential_lock", { p_user_id: userId, p_holder: holder }),
    setPassword: async (userId: string, password: string) => {
      const { error } = await service.auth.admin.updateUserById(userId, { password });
      return !error;
    },
    revokeSession: async (accessToken: string) => {
      // "local" ends only the session the token belongs to.
      await service.auth.admin.signOut(accessToken, "local");
    },
    now: () => new Date(),
  };
}

/** Checks a password with Supabase Auth. A success opens a session, which the caller keeps or ends. */
export function passwordChecker(env: Env) {
  return async (email: string, password: string): Promise<PasswordCheck> => {
    const anon = createClient(env.url, env.anonKey, noSession);
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      const invalid = error?.status === 400 || error?.code === "invalid_credentials";
      return { ok: false, reason: invalid ? "invalid" : "error" };
    }
    const s = data.session;
    return { ok: true, session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at } };
  };
}

/** The verified caller of a request: user id and the session id inside its token. */
export async function verifiedCaller(service: SupabaseClient, token: string) {
  if (!token) return null;
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) return null;
  const sessionId = jwtClaim(token, "session_id");
  return { userId: data.user.id, sessionId: typeof sessionId === "string" ? sessionId : null };
}

export function adminDeps(env: Env, service: SupabaseClient): AdminDeps {
  return {
    callerAdmin: async (token: string) => {
      const caller = await verifiedCaller(service, token);
      if (!caller) return "unauthorized";
      // Run the gate as the caller, so it is the same check RLS uses.
      const asCaller = createClient(env.url, env.anonKey, { ...noSession, global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data, error } = await asCaller.rpc("is_active_administrator");
      return error || !data ? "forbidden" : { userId: caller.userId };
    },
    beginRequest: async (actor, requestId, rpcName, argsHash, target, details) => {
      const { data, error } = await service.rpc("begin_admin_request", {
        p_actor: actor, p_request_id: requestId, p_rpc_name: rpcName, p_args_hash: argsHash,
        p_target_user_id: target, p_details: details,
      });
      if (error) {
        if (error.message.includes("request_id_reused")) return "request_id_reused";
        throw new Error(`begin_admin_request: ${error.message}`);
      }
      return firstRow(data as AdminRequestState[]) as AdminRequestState;
    },
    finishRequest: (actor, requestId, result) =>
      rpc<void>(service, "finish_admin_request", { p_actor: actor, p_request_id: requestId, p_result: result }),
    temporaryPassword: (requestId) => temporaryPassword(env.serviceKey, requestId),
    hash: sha256Hex,
  };
}
