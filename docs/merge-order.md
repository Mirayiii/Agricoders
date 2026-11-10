# Merge order for the open rollout PRs

Nothing is merged yet. When Jac approves, merge in this order. Each PR is
stacked on the one before it, so after each merge GitHub retargets the next PR
(or retarget it by hand) and its diff shrinks to its own phase.

| Order | PR | Branch | Base today | Retarget to after the PR above merges | Needs before merging |
| --- | --- | --- | --- | --- | --- |
| 1 | #4 Fix sku ORDER BY | `claude/fix-migration-sku-order` | `main` | (none) | Nothing. Needed first: without it a fresh database (a test project, or `supabase db reset`) fails. |
| 2 | #1 Phase 0 | `claude/project-thread-6bnusb` | `main` | (none) | Android/iOS device checks. |
| 3 | #2 Phase 1 | `claude/phase-1-sign-in` | Phase 0 branch | `main` | Test-project spike and Auth settings (see `supabase/go-live/phase1/RUNBOOK.md`); admin count and shared accounts answered. |
| 4 | #3 Phase 2 | `claude/phase-2-app-shell` | Phase 1 branch | `main` | Device checks. |
| 5 | #5 Phase 3 | `claude/phase-3-orders` | Phase 2 branch | `main` | Device checks; Phase 3 migration checked on the test project. |
| 6 | #6 Phase 4 | `claude/phase-4-new-order` | Phase 3 branch | `main` | Device checks; Phase 4 migration checked on the test project; D-S1 to D-S3 confirmed or kept as provisional. |
| 7 | #7 Phase 5 | `claude/phase-5-purchasing` | Phase 4 branch | `main` | Device checks (PDF share sheet on Android and iOS); Phase 5 migration checked on the test project; D-P1 and D-S2 confirmed or kept as provisional. |
| 8 | #8 Phase 6 | `claude/phase-6-deliveries` | Phase 5 branch | `main` | Device checks (share, download and print on Android and iOS, Letter print size); Phase 6 migration checked on the test project; DR starting number confirmed. |
| 9 | #9 Phase 7 | `claude/phase-7-customers` | Phase 6 branch | `main` | Device checks (Call and Directions on Android and iOS); Phase 7 migration checked on the test project. |
| 10 | #10 Phase 8 | `claude/phase-8-products-reports` | Phase 7 branch | `main` | Device checks (statement PDF and CSV share on Android and iOS); Phase 8 migration checked on the test project; Jac confirms who may run reports. |
| 11 | #11 Phase 9 | `claude/phase-9-more-settings` | Phase 8 branch | `main` | Device checks (role preview bar and Settings switches on Android and iOS); Phase 9 migration checked on the test project; D-A1 (push events) stays open. |
| 12 | #12 Phase 10 | `claude/phase-10-offline` | Phase 9 branch | `main` | Device checks (airplane mode per module, restart with queued changes, replay after 24 hours on Android and iOS); Phase 10 migration checked on the test project; secure session storage checked on Android and iOS (including an existing signed-in install); cleanup schedule approved before anyone runs `enable_offline_cleanup_schedule()` (see `docs/offline.md`). |

Notes

- #4 is independent of the phase branches. The phase branches carry a local
  test-runner patch for the same bug (`supabase/tests/run_local.sh`); it does
  nothing once #4 is in `main`, and can be removed in a later clean-up.
- Merging a PR changes no hosted database. Migrations reach Supabase only with
  `supabase db push`, and Phase 1's account scripts only by hand, both after
  Jac's approval. Push migrations in file-name order: #4's
  `202611020001_fix_sku_order_by.sql`, then `202611030001_phase1_accounts.sql`,
  then `202611030002_phase3_orders.sql`, then `202611030003_phase4_new_order.sql`,
  then `202611030004_phase5_purchasing.sql`,
  then `202611030005_phase6_deliveries.sql`,
  then `202611030006_phase7_customers.sql`,
  then `202611030007_phase8_products_reports.sql`,
  then `202611030008_phase9_settings.sql`,
  then `202611030009_phase10_offline.sql`,
  then `202611030010_offline_cleanup_schedule.sql` (defines the schedule only; switching it on is a separate, approved step),
  then `202611030011_integration_review_fixes.sql` (signed-out callers can't
  run the reminder function; staff can record their refused offline changes).
- Checked locally on 4 November 2026 (integration review): the stack is in
  order (each branch contains the one below it, #4 merges into it without
  conflicts); a fresh database built from `main` with #4's files and every
  migration above matches the test database; and a database with existing
  data upgrades with every historical total unchanged
  (`supabase/tests/integration/upgrade.sh`). None of this ran on a hosted
  project.
- If a later phase needs changing after an earlier one merges, merge the
  updated base into it (no force-pushes on shared branches).
