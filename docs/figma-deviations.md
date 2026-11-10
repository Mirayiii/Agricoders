# Where the app differs from Figma

Figma file: "MEAH (High-Fidelity)". Checked screen by screen in the Phases 0 to
10 integration review on 4 November 2026. Jac approved every difference below. The
last six were implementation choices until Jac approved them all on 4 November
2026; none is waiting for a decision.

## Approved by Jac

| Area | Figma | App | Jac's decision |
| --- | --- | --- | --- |
| Status badges | Red badge used for more than one state | Red (danger) badge only for Cancelled; "Needs attention" is a separate warning beside the status | 3 Nov |
| Password field | Eye icon | Eye and eye-off (eye-off icon added from Lucide) | 3 Nov |
| Checkboxes | Varies | Unchecked = empty rounded square; Pack item keeps circles | 3 Nov |
| Sign-in error | Varies | "Incorrect username or password" | 3 Nov |
| Role name | "Purchasing staff" | Shown as "Purchasing staff"; stored as `fulfillment_staff` (D-R1) | 3 Nov |
| New order | Delivery time picker | Delivery time optional, "Not specified" when empty; clock picker plus typed entry; "Save for verification" kept | 3 Nov |
| Order prices | Price editable | Price overrides administrator-only, enforced on the server; others see prices read-only | 3 Nov |
| Purchasing | Cancel packing, notes pencil | Cancel packing returns to "Ready to start" and keeps ticks; untick allowed; packed items still count in To buy; notes pencil removed | 3 Nov |
| Order numbers | Orders shown as "DR-1048" | Orders keep their ORD numbers; an issued receipt gets its own DR number that never changes | 3 Nov |
| Delivery receipt | Letter layout and a pre-printed 3-ply option | Letter layout only for now | 3 Nov |
| Deliveries | Scheduling | Scheduling stays manual through the existing form | 3 Nov |
| Customers | Order counts | Order counts include cancelled orders | 3 Nov |
| Customer detail | "Proof of billing" upload | Opens the customer statement (period, orders, Share PDF), administrators only; hidden for administrative staff | 3 Nov |
| Products | "Delete product" | Products are archived, never deleted (the rule is approved; see the label below) | 3 Nov |
| Reports | Reports for office roles | Reports are administrator-only, enforced on the server | 3 Nov |
| More (administrative staff) | No Products & stock | Matches Figma again: no Products & stock (requirement SI-02 replaced the earlier decision) | 4 Nov, superseded by the requirements document |
| Add user | Temporary password | Server-generated, shown once with Copy, expires after 72 hours; contact email optional | 4 Nov |
| Settings | Push and low-stock switches | Shown as "Not available yet" until D-A1 (push events) is decided | 4 Nov |
| Help & support | Contact details | "Contact your administrator", with no contact details | 4 Nov |
| Order totals | Line amounts and total | Orders created before the rollout keep their old totals; new orders round each line first | 3 Nov |
| Order detail offline | Flag can be cleared offline | Clearing a flag needs a connection | 4 Nov ("Keep clearing flags online-only for now") |
| Orders offline | Plan row 10.4 and Figma: "confirm or update an order" offline | Offline order actions are Confirm and creating new orders only; discount, SI#, editing items and cancelling need a connection. Packing and delivery keep their offline actions | 4 Nov |
| Customers and Products offline | Add and Edit disabled offline | Add, Edit, Archive, price and stock buttons stay visible but disabled, with "Requires a connection" | 4 Nov (matches Figma) |
| Receipts for old orders | Lines add up to the total | An order from before the rollout keeps its old total, so rounded lines can differ by a centavo; only those receipts say "Total as originally recorded; line amounts are rounded." | 4 Nov |
| "Delete product" label | "Delete product" | Labelled "Archive product" (archive-only rule) | 4 Nov |
| Batch update prices | Separate entry | A price-tag button in the Products & stock header | 4 Nov |
| Product margins | Margin shown | Margin = (selling − cost) ÷ selling; cost 0 shows no margin; selling price 0 refused; no back-dated prices; changing a priced product's default unit needs new prices | 4 Nov |
| Sales report | Sales totals | Counts Confirmed through Completed orders, by delivery date, after discounts | 4 Nov |
| Back online banner | "Back online · All changes synced" | Says "All changes synced" only when something was actually synced; otherwise just "Back online" | 4 Nov |

## Changed to follow the requirements document

On 4 November 2026 Jac made REQUIREMENTS_ENGINEERING-v1.28.10.2026 (Revision 2.1)
the source of truth for business logic, permissions and workflows. Figma is kept
wherever it fits the requirements.

| Area | Figma | App | Requirement |
| --- | --- | --- | --- |
| New order | Delivery date and time on step 3 | Step 1 is customer and schedule, step 2 items, step 3 review and submit. The Figma screens are reused | NO-01 |
| Products & stock | Office staff could manage products and prices | Administrator only, in the app and on the server; office staff still pick products and see prices on orders | SI-02, PS-01 to PS-03, RE-05 |
| Customer archive | Archive for office staff | Archive and restore are administrator only | CU-01 |
| Customer details | No business type or delivery window | Both added as optional fields | CU-01 |
| Delivery receipt | Issued from Preparing by the office | Available from Confirmed to the administrator, administrative staff and the assigned driver | DE-03 |
| Delivery receipt contents | Fixed once issued | DR number fixed; contents refresh from the saved order until the delivery is completed, then frozen. If the order is cancelled, the receipt keeps its DR number and details and shows "VOID — Order cancelled" | DE-03 |
| New order stock tag | Stock tag for office staff | Administrator only; office staff see products and prices but no stock (replaces D-S1) | SI-02, PS-02 |
| Mark delivered | Office staff could mark delivered | Needs an assigned driver first; then only that driver or the administrator, on every route including offline sync | DE-04 |
| Purchasing Home | Ready to start, Items left to pack | Adds "Today's purchasing": orders awaiting buying (from the To buy ticks) and packing | HD-03 |
| To buy | Stock and "Buy X more" per line, no ticks | Lines can be ticked as bought (saved per product and delivery day, shared, online only, shown only after the server confirms); "Need X more" when demand grows; progress bar. Stock shows for the administrator only | PU-01, SI-02, PS-02 |
| Order quantities | No check | Warning above 3× the customer's usual quantity (median of last 10 orders, at least 3) on New order and Edit order (the edited order is left out); can still submit | NO-02 |
| Settings, notifications | Push and low-stock rows | In-app delivery reminders plus push switches only for events the role already gets; no low-stock row | AS-02, AS-03 |
| Purchasing notifications | None | "Ready to buy" when an order is confirmed; opens To buy on that day | AS-02, AS-03 |

