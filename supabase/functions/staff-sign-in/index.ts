// Username sign-in for MEAH staff (task 1.8). The app calls it before it has
// a session, with only the project's anon key, so every check happens here.
// The logic lives in ../_shared/signIn.ts.
import { clientIp, corsHeaders, json, readJson } from "../_shared/http.ts";
import { staffSignIn } from "../_shared/signIn.ts";
import { accountDeps, passwordChecker, readEnv, serviceClient } from "../_shared/supabaseDeps.ts";

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
    const outcome = await staffSignIn(
      {
        ...accounts,
        recordResult: async (key, success, info) => {
          await service.rpc("record_login_result", {
            p_key: key, p_success: success, p_user_id: info.userId ?? null,
            p_username: info.username, p_ip: info.ip, p_result: info.result,
          });
        },
        checkPassword: passwordChecker(env),
      },
      { username: body.username, password: body.password, ip: clientIp(req) },
    );
    return json(outcome, outcome.result === "invalid_request" ? 400 : 200);
  } catch (error) {
    console.error("staff-sign-in", error);
    return json({ result: "error" }, 500);
  }
});
