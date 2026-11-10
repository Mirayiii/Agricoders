# Edge Functions

| Function | Who calls it | What it does |
| --- | --- | --- |
| `staff-sign-in` | The app, before sign-in | Username sign-in with the 5-attempt lockout (D0, D4). Returns a session. |
| `staff-change-password` | Signed-in staff | Required change after a temporary password or the D11 upgrade, and Settings > Change password. |
| `admin-reset-password` | Administrators | Sets a 72-hour temporary password and signs the person out everywhere. |
| `admin-create-user` | Administrators | Creates a username account with a temporary password. No email is sent. |

The logic of each function is in `_shared/` (`signIn.ts`, `changePassword.ts`,
`adminReset.ts`, `adminCreate.ts`) and takes its database and Auth calls as
arguments, so it is tested without Supabase: `npm run test:functions`.
`_shared/supabaseDeps.ts` wires the real calls.

## Deploying (needs Jac's approval: not done yet)

1. Apply `supabase/migrations/202611030001_phase1_accounts.sql` first.
2. `staff-sign-in` is called with only the publishable key, which is not a JWT,
   so deploy it without the gateway's JWT check. It does all its own checks.

   ```
   supabase functions deploy staff-sign-in --no-verify-jwt
   supabase functions deploy staff-change-password
   supabase functions deploy admin-reset-password
   supabase functions deploy admin-create-user
   ```
3. The functions read `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY`, which Supabase provides. Temporary passwords are
   derived from the service-role key and the request id, so rotating that key
   only changes passwords for requests made after the rotation.

## Still to confirm on a test project (spike 1.0)

- A wrong password is refused before Supabase looks at anything else, so the
  lockout and "deactivated" messages behave as tested here.
- `auth.admin.signOut(token, "local")` ends only that session.
- `auth.admin.createUser` accepts `<request id>@staff.meah.invalid` addresses.
- `SUPABASE_ANON_KEY` is still provided alongside the new publishable keys.
