// Administrator resets a staff member's password to a temporary one (task 1.10).
// The logic lives in ../_shared/adminReset.ts.
import { adminResetPassword } from "../_shared/adminReset.ts";
import { bearerToken, corsHeaders, json, readJson } from "../_shared/http.ts";
import { accountDeps, adminDeps, readEnv, serviceClient } from "../_shared/supabaseDeps.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ result: "invalid_request" }, 405);
  const env = readEnv();
  if (!env) return json({ result: "error" }, 500);
  const body = await readJson(req);
  if (!body) return json({ result: "invalid_request" }, 400);

  const service = serviceClient(env);
  const accounts = accountDeps(service);
  try {
    const outcome = await adminResetPassword(
      {
        ...adminDeps(env, service),
        ...accounts,
        userExists: async (userId) => (await accounts.lookupById(userId)) !== null,
        beginReset: async (actor, userId) => {
          const { error } = await service.rpc("begin_password_reset", { p_actor: actor, p_user_id: userId });
          if (error) throw new Error(`begin_password_reset: ${error.message}`);
        },
        revokeAllSessions: async (userId) => {
          const { error } = await service.rpc("revoke_user_sessions", { p_user_id: userId, p_keep_session: null });
          if (error) throw new Error(`revoke_user_sessions: ${error.message}`);
        },
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
      { token: bearerToken(req), requestId: body.request_id, userId: body.user_id },
    );
    const status = { unauthorized: 401, forbidden: 403, invalid_request: 400, not_found: 404 }[outcome.result as string] ?? 200;
    return json(outcome, status);
  } catch (error) {
    console.error("admin-reset-password", error);
    return json({ result: "error" }, 500);
  }
});
