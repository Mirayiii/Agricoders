# Phase 1 go-live scripts

These change live accounts, so they are **not** in `supabase/migrations` and
`supabase db push` never runs them. Run them by hand, in order, only during the
go-live window agreed with Jac (rollout plan task 1.14), after the backups.

| Step | File | What it does |
| --- | --- | --- |
| 0 | `00_preview_usernames.sql` | Shows the usernames step 1 would give, then rolls back. Changes nothing; safe to rerun. |
| 1 | `01_username_backfill.sql` | Gives every account without a username one that follows D2, and fills `username_migration_report`. Changes nothing else. |
| 2 | (review) | An administrator reads `select * from username_migration_report order by full_name;` and renames anything wrong with `admin_change_username`. |
| 3 | `02_require_username.sql` | Makes the username required. Fails safely if any account still has none. |
| 4 | `03_policy_upgrade_flag.sql` | D11: every existing account must choose a new password (D5 rules) at its next sign-in. No expiry applies, so existing passwords keep working until then. |

Before these: Migration A (`supabase/migrations/202611030001_phase1_accounts.sql`)
and the Edge Functions must be deployed, and the Auth settings in task 1.6 applied
(sign-up off, 900-second JWT expiry, password minimum length 8 with all character
types). Real emails stay as they are (D1).

The full sequence, test-project setup, exact Auth settings and deploy commands
are in [RUNBOOK.md](RUNBOOK.md).
