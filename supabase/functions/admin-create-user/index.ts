// Administrator creates a staff account with a username and a temporary
// password (task 1.11). Staff never receive email: the Auth email is an
// internal address. The logic lives in ../_shared/adminCreate.ts.
//
// This runs with the service-role key, which must never ship in the app.
// Authorization is re-checked here with the caller's own token.
import { adminCreateUser } from "../_shared/adminCreate.ts";
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
  try {
    const outcome = await adminCreateUser(
      {
        ...adminDeps(env, service),
        setPassword: accountDeps(service).setPassword,
        usernameAvailable: async (username, exceptRequest) => {
          const { data, error } = await service.rpc("username_available", { p_username: username, p_except_request: exceptRequest });
          if (error) throw new Error(`username_available: ${error.message}`);
          return data === true;
        },
        findAuthUser: async (email) => {
          const { data, error } = await service.rpc("auth_user_id_by_email", { p_email: email });
          if (error) throw new Error(`auth_user_id_by_email: ${error.message}`);
          return (data as string | null) ?? null;
        },
        createAuthUser: async ({ email, password, username, fullName }) => {
          const { data, error } = await service.auth.admin.createUser({
            email, password, email_confirm: true,
            user_metadata: { username, full_name: fullName },
          });
          if (data?.user) return { userId: data.user.id };
          if (error && /already (been )?registered|already exists/i.test(error.message)) return "exists";
          console.error("admin-create-user: createUser", error?.message);
          return "failed";
        },
        setRequestTarget: async (actor, requestId, userId) => {
          const { error } = await service.rpc("set_admin_request_target", { p_actor: actor, p_request_id: requestId, p_target: userId });
          if (error) throw new Error(`set_admin_request_target: ${error.message}`);
        },
        finishCreate: async (input) => {
          const { error } = await service.rpc("finish_create_user", {
            p_actor: input.actor, p_request_id: input.requestId, p_user_id: input.userId,
            p_username: input.username, p_full_name: input.fullName, p_role: input.role,
            p_contact_email: input.contactEmail,
          });
          if (!error) return "ok";
          if (error.message.includes("username_taken")) return "username_taken";
          throw new Error(`finish_create_user: ${error.message}`);
        },
      },
      {
        token: bearerToken(req), requestId: body.request_id, username: body.username,
        fullName: body.full_name, role: body.role, contactEmail: body.contact_email,
      },
    );
    const status = { unauthorized: 401, forbidden: 403, invalid_request: 400, invalid_field: 400 }[outcome.result as string] ?? 200;
    return json(outcome, status);
  } catch (error) {
    console.error("admin-create-user", error);
    return json({ result: "error" }, 500);
  }
});
