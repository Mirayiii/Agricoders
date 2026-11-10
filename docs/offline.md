# Offline support (task 0.6 design, built in Phase 10)

Designed in Phase 0 and built in Phase 10 (PR #12) with Jac's decisions of
4 November 2026 (D-OF1 to D-OF4, below). Code: `src/services/offline`.
Server: `supabase/migrations/202611030009_phase10_offline.sql`.

## What works offline

| Area (plan row) | Read offline | Change offline |
| --- | --- | --- |
| Connection (10.1) | Banner on every screen; Settings shows Connected or Offline with Retry | |
| Deliveries (10.2) | Today's stops and stop details | Mark delivered (queued) |
| Purchasing (10.3) | Packing list | Tick or untick packed (queued). Start and cancel packing need a connection |
| Orders and Home (10.4) | Lists, order details, counts | Confirm an order For verification (queued); new orders (row 10.5). Clearing a flag and every other order update need a connection (Jac, 4 Nov) |
| New order (10.5) | Customers, products and prices | Save new order (queued, with a price review) |
| Customers and Products (10.6) | Last saved data | None: Add, Edit, Archive, price and stock buttons show disabled with "Requires a connection" (Figma; Jac, 4 Nov) |
| Reports (10.7) | Not saved; shows "Reports need a connection" with when it was last updated | None |

Anything else that changes data fails straight away offline with a message.
React Query's own "pause while offline and send later" is turned off for all
changes (`networkMode: "always"`), because it would replay them later with no
version checks.

## Reads
- All server data goes through one cache (TanStack Query, task 0.5), kept for 30 days.
- The cache is saved on the phone per user (`meah.cache.v1.<userId>`) when "Keep me signed in" is on, and kept in memory only when it is off. Reports are never saved.
- Offline, a refresh fails at once and screens show the saved data with "Showing data saved at …" (or "couldn't be loaded" if it was never opened on this phone). Everything refreshes when the connection returns.

## Writes and the outbox
- Four changes are offline-safe: mark delivered, tick packed, confirm order and save new order. They always go through `offline_*` server functions, online too, with one request id per change, so a retry after a lost answer is applied once.
- Online they are sent straight away. Offline, or when the server doesn't answer, they are saved in the outbox (`meah.outbox.v1.<userId>`) and sent oldest first when the connection returns, when the app comes back to the front, and from Sync now.
- With "Keep me signed in" off, the outbox lives in memory only. Before the first offline change in a session the app warns that it will be lost if the app closes, and asks before saving it.
- States shown on the record and under Settings, Offline changes: Waiting to sync, Syncing, Synced (listed for a day), Needs review.
- A change cut off mid-send (app closed) goes back to Waiting after a restart and is sent again with the same id; the server returns the first result.

## Conflicts (D-OF1)
The server re-checks everything before applying a queued change: the person's
role and account, assignments, status and the version the person saw.
A change that no longer fits is refused with a reason and held for review;
nothing newer is overwritten.

- **Mark delivered:** refused if the stop was reassigned, rescheduled, already delivered or cancelled, or the order changed after it was loaded.
- **Tick packed:** refused if the line was removed, its quantity or unit changed, or someone else ticked or unticked it since.
- **Confirm order:** refused if the order is no longer For verification, is flagged for checking, or changed since.
- **New order:** if any price shown is different now, nothing is saved and old and new prices are listed. The person chooses Send at current prices (same request id) or Dismiss. Online saves get the same check. Prices an administrator typed are kept as typed and not compared.

## Errors are told apart
- **No answer** (network): the change stays waiting; the app shows Offline until the next check.
- **Session ended** (expired or signed out elsewhere): sending stops, nothing is discarded, and the banner asks the person to sign in again.
- **Permission** (role changed or account deactivated): refused, not retried. The app re-checks the account; a deactivated account is signed out and its outbox and saved data are removed from the phone.
- **Conflict, expired, price changed:** held for review with the reason.

## Logout (D-OF2)
With unsynced changes, Sign out offers Sync now (when online), Cancel sign out,
and Discard and sign out with a second confirmation that lists the changes.
Nobody is kept signed in against their will. Sign-out clears that user's
outbox and saved data.

## Time limits (D-OF3)
- Queued changes are accepted for 30 days. Older ones are refused by the phone and by the server (`OFEXP`), never sent as new requests.
- Duplicate-protection records (`mutation_requests`) are kept at least 90 days. `prune_offline_records()` removes finished records older than 90 days (counted from when they finished) and never removes a request still marked pending.
- A pruned request can never run again, whatever time the phone sends with it. The 30-day limit uses the time the phone saved, which a modified app could change, so it is not relied on for this: pruning keeps the request id (with no arguments or results) in `mutation_request_tombstones`, and the server checks every request id against it before anything else (`OFEXP`, nothing saved). Those ids are kept until a reliable expiry exists, for example request ids that carry a time signed by the server. Fix and regression test: `202611030011_integration_review_fixes.sql`, `supabase/tests/phase10/03_pruned_replay.sql`.
- A saved time more than a day in the future, or more than 30 days in the past, is refused too.
- The daily schedule is prepared in `202611030010_offline_cleanup_schedule.sql` but **not switched on**. After Jac's approval, on a project with `pg_cron` enabled, the database owner runs `select public.enable_offline_cleanup_schedule();` (daily at 03:15 Manila). `disable_offline_cleanup_schedule()` switches it off. The app cannot call either.

## Reporting refusals (D-OF4)
- When the phone can reach the server, every refusal is recorded in `sync_rejections` (only the person's own rows can be written). Price reviews are not, because nothing was refused yet.
- Discarding at sign-out is recorded as "discarded" only when online. Offline, the confirmation says it can't be recorded, and the app never claims it was.
- Administrators see them under Settings, Offline sync problems. Other staff can read only their own rows: PostgreSQL needs that for the app's "ignore duplicates" insert, and without it nobody but administrators could record a refusal (found and fixed in the integration review, `202611030011_integration_review_fixes.sql`).

## Duplicate protection (server)
- `mutation_requests (user_id, request_id, rpc_name, args_hash, result, created_at)`, primary key `(user_id, request_id)`.
- **Same request id with different arguments:** refused with `request_id_reused`.
- **Same request id and same arguments:** the function re-checks permissions, then returns the stored result.
- The `offline_*` wrappers record their own request and call the original function with a derived inner id (`offline_inner_request_id`). A new order's request ignores the "accept current prices" flag, so a retry of an order that was saved returns that order instead of a price review.

## Session storage (task 0.6)
- "Keep me signed in" on: on phones the session is saved in `expo-secure-store` (Keychain on iOS, Keystore-backed on Android, this device only, readable after first unlock). It is saved in chunks because a Supabase session is larger than one secure item on Android, and read back only when every chunk is there.
- "Keep me signed in" off: memory only, on every platform. Signing in this way removes any session saved earlier.
- Web: browsers have no secure store, so the session stays in the browser's storage as before.
- Existing installs: a session saved in AsyncStorage by an earlier version is moved to the secure store the first time it is read, then removed from AsyncStorage. If the move fails, the person stays signed in and it is tried again next start.
- Sign-out removes the session from memory, the secure store and AsyncStorage.
- If a store fails, sign-in still works for this run (memory). Only a short reason is reported in development builds; token values are never logged or put in an error. Code: `lib/sessionStore.ts`, tests: `tests/app/sessionStore.test.ts`.

## Accounts on a shared phone
- The outbox and saved cache are kept per user id. One person's changes are never shown to, counted for or sent by another account; sending stops if the account changes mid-sync.
- A role preview keeps the administrator's own outbox.

## Not verified yet
- **Devices:** no Android or iOS check yet. Untested on devices: airplane mode per row, NetInfo detection, AsyncStorage persistence across a restart, the memory-only warning (a system alert on phones, a sheet on the web), and replay after 24 hours. Web previews and unit and database tests cover the logic.
- **Secure session storage on devices:** built and unit-tested with pretend stores, not yet run on a phone. Check on Android and iOS: sign in with "Keep me signed in" on, restart, still signed in; with it off, restart, signed out; an existing install signed in before this change stays signed in and its session moves out of AsyncStorage; sign out leaves no session behind.
- **Deactivation found at start-up:** if the app learns an account was deactivated when it starts (before it could sync), that account's queued changes are never sent and can't be reported, because there is no session. They stay unsent on the phone.
- **Hosted database:** the Phase 10 migration has only run against the local test database.
- **Cleanup schedule:** prepared, not switched on (see D-OF3); `pg_cron` isn't available in the local test database, so only the "not enabled" path is tested here.
