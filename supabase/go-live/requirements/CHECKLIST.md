# Go-live checklist: requirements alignment (PR #13)

Nothing here has been run on the live project. Every step needs Jac's
approval first, like any hosted migration.

## Before the migrations

1. Take a backup (see `../phase1/RUNBOOK.md`, B1).
2. **DE-04, unassigned stops.** Run `01_unassigned_out_for_delivery.sql` in the
   SQL editor. It only reads. For each row, ask the team which driver has the
   stop and assign that driver in the app (Deliveries > stop > Assign driver).
   Stops listed first are already out for delivery. Do not guess a driver:
   after the migrations, nobody can mark these stops delivered until one is
   assigned.
3. Note the result count here: ______ stops, assigned by ______ on ______.

## Migrations, in this order

1. `202611040001_requirements_rules.sql`
2. `202611040002_requirements_decisions.sql`
   - Receipts of completed or cancelled orders become final (contents kept).
3. `202611040003_requirements_followups.sql`
   - Receipts of orders that were already cancelled are marked VOID (DR number
     and contents kept).

## After the migrations (live, read-only checks)

1. Run `01_unassigned_out_for_delivery.sql` again. It should return no rows
   that are out for delivery; assign any that appear.
2. Open one cancelled order that had a receipt: the receipt shows
   "VOID — Order cancelled".
3. Sign in as administrative staff and open New order without saving: no
   stock tags show.

## On the test project only (creates test orders)

1. As administrative staff, save an order for more than the stock on hand:
   it saves, with no stock warning.
2. Confirm it: each purchasing staff account gets one "Ready to buy"
   notification; tapping it opens To buy on that order's delivery day.
