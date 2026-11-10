// Change password for a signed-in staff member (task 1.9), including the
// required change after a temporary password or the D11 policy upgrade.
// The logic lives in ../_shared/changePassword.ts.
import { staffChangePassword } from "../_shared/changePassword.ts";
import { bearerToken, corsHeaders, json, readJson } from "../_shared/http.ts";
import { accountDeps, passwordChecker, readEnv, serviceClient, verifiedCaller } from "../_shared/supabaseDeps.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ result: "invalid_request" }, 405);
  const env = readEnv();
  if (!env) return json({ result: "error" }, 500);
  const body = await readJson(req);
  if (!body) return json({ result: "invalid_request" }, 400);

  const service = serviceClient(env);
  try {
    const outcome = await staffChangePassword(
      {
        ...accountDeps(service),
        caller: (token) => verifiedCaller(service, token),
        recordResult: async (key, success, info) => {
          await service.rpc("record_login_result", {
            p_key: key, p_success: success, p_user_id: info.userId, p_result: info.result,
          });
        },
        checkPassword: passwordChecker(env),
        confirmWindow: async (userId, holder, version) => {
          const { data, error } = await service.rpc("confirm_password_change_window", { p_user_id: userId, p_holder: holder, p_noted_version: version });
          return !error && data === true;
        },
        completeChange: async (userId, version) => {
          const { data, error } = await service.rpc("complete_password_change", { p_user_id: userId, p_noted_version: version });
          return !error && data === true;
        },
        revokeOtherSessions: async (userId, keep) => {
          await service.rpc("revoke_user_sessions", { p_user_id: userId, p_keep_session: keep });
        },
      },
      { token: bearerToken(req), currentPassword: body.current_password, newPassword: body.new_password },
    );
    const status = outcome.result === "unauthorized" ? 401 : outcome.result === "invalid_request" ? 400 : 200;
    return json(outcome, status);
  } catch (error) {
    console.error("staff-change-password", error);
    return json({ result: "error" }, 500);
  }
});
