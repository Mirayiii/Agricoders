# Phase 1 runbook: test project, Auth settings, deploy, account migration

Status on 2026-11-03: **prepared, nothing run.** Every step below that touches a
hosted Supabase project needs Jac's go-ahead first. Part A uses a separate
**test** project only. Part B is the live go-live and is not approved yet.

Open questions that do not block Part A: how many administrators there will be,
and whether any staff share an account.

---

## Part A. Test project (spike task 1.0)

Goal: prove on real Supabase Auth what the local tests can only fake.

### A1. Create and link the test project

1. In the Supabase dashboard, create a new project, for example `meah-test`, in
   the same region as production. Note its project ref (`<test-ref>`).
2. On a machine with the Supabase CLI and this repo:

   ```
   supabase login
   supabase link --project-ref <test-ref>
   ```

   Check `supabase/.temp/project-ref` now holds `<test-ref>` and **not** the
   production ref before any command below.

### A2. Apply the database

The two shipped migrations with the `sku` ORDER BY bug fail on a fresh database
until PR #4 is merged. On the test project, push from a local branch that
includes it:

```
git fetch origin
git checkout -b test-project-push origin/claude/phase-1-sign-in
git merge --no-edit origin/claude/fix-migration-sku-order
supabase db push
```

Do not push that local branch to GitHub. It exists only to set up the test project.

### A3. Create the first administrator (test only)

1. Dashboard > Authentication > Users > Add user > "Create new user". Use any
   address you control on the test project, tick "Auto confirm", and a password
   that meets D5 (8+ characters, upper, lower, digit, one of `!@#$%^&*`).
2. In the SQL editor:

   ```sql
   update public.profiles
   set role = 'administrator', status = 'active', username = 'test.admin'
   where email = lower('<that address>');
   ```

### A4. Apply the Auth settings (task 1.6) on the test project

Export the current settings first, so they can be compared and restored.
`SUPABASE_ACCESS_TOKEN` is a personal access token from Account > Access Tokens.

```
curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/<test-ref>/config/auth > auth-before-<test-ref>.json
```

The exact settings:

| Setting (dashboard) | Value | Management API field | `config.toml` |
| --- | --- | --- | --- |
| Authentication > Sign In / Providers > "Allow new users to sign up" | Off | `"disable_signup": true` | `[auth] enable_signup = false` |
| Authentication > Sign In / Providers > Email > "Minimum password length" | 8 | `"password_min_length": 8` | `[auth] minimum_password_length = 8` |
| Same page > "Password requirements" | Lowercase, uppercase letters, digits and symbols | `"password_required_characters"` (copy the value from the export after setting it in the dashboard) | `[auth] password_requirements = "lower_upper_letters_digits_symbols"` |
| Settings > JWT Keys > "Access token expiry time" | 900 seconds (D7) | `"jwt_exp": 900` | `[auth] jwt_expiry = 900` |

The easiest safe way is to set them in the dashboard, then export again and
compare:

```
curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/<test-ref>/config/auth > auth-after-<test-ref>.json
diff <(jq -S . auth-before-<test-ref>.json) <(jq -S . auth-after-<test-ref>.json)
```

The diff should show only `disable_signup`, `password_min_length`,
`password_required_characters` and `jwt_exp`. The same change through the API:

```
curl -sS -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  https://api.supabase.com/v1/projects/<test-ref>/config/auth \
  -d '{"disable_signup": true, "password_min_length": 8, "jwt_exp": 900}'
```

Notes:
- Supabase's symbol list is wider than D5's `!@#$%^&*`. Every D5 password passes
  it; the D5 list itself is enforced by our Edge Functions and the app.
- "Keep me signed in" (D8) is an app setting. No Auth setting is needed.
- Sign-up off does not stop `admin-create-user`, which uses the admin API.

### A5. Deploy the Edge Functions to the test project

```
supabase functions deploy staff-sign-in --no-verify-jwt --project-ref <test-ref>
supabase functions deploy staff-change-password --project-ref <test-ref>
supabase functions deploy admin-reset-password --project-ref <test-ref>
supabase functions deploy admin-create-user --project-ref <test-ref>
supabase functions list --project-ref <test-ref>
```

`staff-sign-in` needs `--no-verify-jwt` because the app calls it with the
publishable key, which is not a JWT. It does all its own checks. No secrets need
setting: Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`.

### A6. Run the spike checks

```
SUPABASE_URL=https://<test-ref>.supabase.co \
SUPABASE_ANON_KEY=<test anon key> \
SUPABASE_SERVICE_ROLE_KEY=<test service role key> \
SPIKE_ADMIN_USERNAME=test.admin SPIKE_ADMIN_PASSWORD='<A3 password>' \
node supabase/tests/spike/spike.mjs --test-project <test-ref>
```

The script refuses to run unless `--test-project` matches the URL. It creates
`spike.*` accounts and deletes them at the end. It checks:

1. Username sign-in through `staff-sign-in`.
2. `admin-create-user` accepts `<request id>@staff.meah.invalid`, and a retry
   returns the same account and password.
3. A temporary password signs in as "must change", reads no data, and cannot
   clear its own flag.
4. `staff-change-password` works.
5. The 6th attempt is locked even with the right password; admin unlock works.
6. 10 parallel wrong attempts: exactly 5 are refused as locked.
7. Direct Supabase sign-in with the internal email does not touch our counter
   (the documented limit of D0).
8. `auth.admin.signOut(token, "local")` ends only that session.
9. A reset blocks the old session's data at once, and it cannot refresh.
10. Deactivated + wrong password says "invalid"; deactivated + right password
    says "deactivated".
11. Access tokens last 900 seconds.

Also check by hand:
- **Sign-in rate limit.** Every username sign-in reaches Supabase Auth from the
  Edge Function, so they may share one IP. In Authentication > Rate Limits, note
  "sign-ups and sign-ins" (default 30 per 5 minutes per IP). Try 31 sign-ins in
  5 minutes; if the 31st is rate limited, raise that limit before go-live.
- The app on Android and iOS against the test project, with
  `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` pointing at it
  (the device checklist in the Phase 1 PR).

### A7. Rehearse the account migration on the test project

Create a few accounts in the dashboard (they get `user_…` placeholder
usernames), then run Part B steps B3 to B6 against the test project.

---

## Part B. Live go-live (task 1.14). Not approved yet.

Run in an agreed quiet window. Stop at the first error.

### B1. Backups

```
supabase link --project-ref <prod-ref>
supabase db dump --linked --role-only -f backup-<date>-roles.sql
supabase db dump --linked -f backup-<date>-schema.sql
supabase db dump --linked --data-only --use-copy -f backup-<date>-data.sql
curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/<prod-ref>/config/auth > auth-before-<prod-ref>.json
```

Store these outside the repo (they hold personal data).

### B2. Database and functions

1. Merge PR #4 first (fixes the `sku` migrations), then the Phase 1 PR.
2. `supabase db push` (Migration A: `202611030001_phase1_accounts.sql`).
3. Deploy the four functions as in A5, with `--project-ref <prod-ref>`.

### B3. Preview usernames (changes nothing)

```
psql "$PROD_DB_URL" -f supabase/go-live/phase1/00_preview_usernames.sql
```

It runs the real backfill inside a transaction, prints every proposed username
with its reason, and rolls back. Send the list to Jac to check. Rerun as often as
needed.

### B4. Give every account a username

```
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/go-live/phase1/01_username_backfill.sql
```

Then an administrator reviews
`select * from username_migration_report order by full_name;` and fixes any name
with `admin_change_username` (Users screen > Rename).

### B5. Make usernames required

```
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/go-live/phase1/02_require_username.sql
```

### B6. Policy upgrade (D11)

```
psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/go-live/phase1/03_policy_upgrade_flag.sql
```

Every existing account chooses a new D5 password at its next sign-in. Existing
passwords keep working until then.

### B7. Auth settings

Apply A4 to `<prod-ref>`, export `auth-after-<prod-ref>.json` and check the diff.

### B8. Release the app build, then tell staff their username.

### Rollback

- Before B5: usernames can be cleared with
  `update public.profiles set username = null where username is not null;` only
  if nothing else depends on them yet. Prefer fixing names with
  `admin_change_username`.
- Auth settings: PATCH the values back from `auth-before-<prod-ref>.json`.
- Functions: the old app does not call them; leaving them deployed is harmless.
- Full restore from the B1 dump is the last resort.
