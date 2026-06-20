# OmniBite
## Restaurant QR Ordering and Payment System — Feature Specification

OmniBite is a custom dine-in ordering, kitchen, and payment platform for multi-location restaurant groups in Kenya. Diners order from their table by QR, pay by M-Pesa before the kitchen cooks, track their order live, and leave without flagging down a waiter. The design removes dine-and-dash structurally and treats Kenyan tax, payment, and data law as core requirements, not afterthoughts.

Context assumptions: Kenya, M-Pesa via the Daraja API, casual sit-down dining, web-based with no app download for diners.

---

# Part A — Diner-facing

## 1. QR table ordering
- QR per table encodes location ID plus table ID. The diner scans, lands on that location's live menu, and joins that table's session. No app download.
- Placed items become a kitchen ticket carrying the table ID.
- The kitchen ticket fires only after payment confirms. No payment, no food. See Part B.

## 2. Shared table ordering (multiple diners, different meals)
- Everyone who scans the same table QR joins one shared session tied to that table ID.
- Each diner adds their own items from their own phone. Every item is tagged to the person who ordered it, which is what makes split payment work.
- Each diner pays their own portion by M-Pesa against the shared table ID.
- The kitchen holds and fires the whole table as one coursed ticket once the round is paid, so the table eats together rather than dishes trickling out per person.
- Later additions open a new paid round on the same session.

## 3. Order tracking
- The diner's screen moves through received, preparing, and ready.
- The time estimate comes from the kitchen's real queue depth plus a per-item prep time, never a fixed or customer-set number, and the kitchen can bump it when slammed.

## 4. Menu model
- Items carry photos, descriptions, price, and dietary and allergen tags. Allergens are a safety and legal matter, not optional.
- A modifier engine handles choices and add-ons (no onions, choose a side, combos, extras with price deltas).
- Real-time 86ing: when the kitchen marks an item out, it greys out across every active and incoming order at that location within seconds.

## 5. Diner extras
- Item-level feedback tied to the exact order and ticket, so a complaint points the kitchen at the specific dish.
- SMS receipt to the diner's phone, separate from the payment confirmation.
- English and Swahili menu toggle.
- Loyalty keyed to the M-Pesa phone number, so a returning diner's favorites and allergies surface on their tab.

---

# Part B — Payments and money

This is the heart of OmniBite and where most of the risk lives.

## 6. Pay-before-fire
- Placing an order triggers an STK push (Lipa na M-Pesa Online) to the diner's phone. They enter their M-Pesa PIN.
- The table ID rides in the account reference. The Daraja callback matches payment to table, marks the order paid, fires the kitchen ticket, and updates the floor map.
- Because food only cooks after payment confirms, there is never unpaid food on a table. Dine-and-dash is removed by design.
- M-Pesa has no card-style hold or pre-authorization, so pay-per-round is mandatory, not a preference.

## 7. M-Pesa reliability (the unhappy paths)
The happy path is the easy 20 percent. Build for the rest:
- Dropped callbacks: when no callback arrives in time, query the Daraja transaction status API to confirm the true outcome before deciding.
- Idempotency: dedupe on the transaction reference so a retried or duplicated callback never double-charges or double-fires.
- Customer non-action: handle ignored prompts, wrong PIN, insufficient balance, and timeouts with a clear retry path.
- Nightly reconciliation: an automated job matches the M-Pesa statement against OmniBite's recorded sales and flags any mismatch.

## 8. Mixed payment: M-Pesa, card, cash
The system must not assume M-Pesa only. A big restaurant serves tourists and cash payers.
- M-Pesa: primary, per round, as above.
- Card: a payment gateway for Visa and Mastercard, needed for tourists and corporate diners.
- Cash: a server-recorded cash path with drawer reconciliation at end of shift.
- One table can mix all three across its diners.

## 9. Refunds and failed orders
The necessary other half of pay-before-fire, since money is taken first.
- If the kitchen 86s an item after payment, or food comes out wrong, OmniBite owes a reversal.
- Offer store credit as the default remedy and a true M-Pesa reversal as the fallback, since reversals are slow and partly manual.
- Every refund is logged, reason-coded, and requires the right staff role. See Part D.

## 10. Split payment and tipping
- Multiple diners each fire their own STK push against the same table ID. The table clears only when the total is covered.
- Tips are added on top and paid in the same push.

## 11. eTIMS tax invoicing (legally mandatory)
Every sale in Kenya requires a real-time electronic tax invoice transmitted to KRA, whether paid by M-Pesa, card, or cash.
- OmniBite generates a compliant invoice through the eTIMS API at the moment of payment.
- The invoice carries the required fields: seller PIN, buyer PIN where the buyer claims input tax, tax amounts, item code and description, quantity, unit, tax rate, a unique system identifier, and a QR code.
- Non-compliance risk is real: penalties reach KES 1 million or 10 percent of the tax involved, and from the 2026 year of income KRA validates declared income against eTIMS records.
- This is a phase-one requirement, not a later add-on.

---

# Part C — Kitchen and floor

## 12. Kitchen Display System
- Tickets split by station (grill, cold, fry, pass), age in real time, bump when done. Replaces paper.
- Coursing and holds: apps fire now, mains fire on a server signal or timer. Shared table tickets fire as one unit.
- Pacing: ticket throttling during a rush plus per-station load balancing.
- Offline resilience: the display queues tickets locally and syncs on reconnect. A paid ticket must never be lost.

## 13. Front desk and floor
- Table state as source of truth: open, seated, ordered, food running, check dropped, paid, needs bussing.
- Floor map shows every table's state, including paid versus unpaid.
- Server app runs the same table state, so QR orders and server-entered orders land in one tab with no reconciliation.
- Call-staff button pings the floor map, not the kitchen, since QR removes the waiter but diners still need help.
- Reservations and waitlist with SMS notifications, feeding the same table state.

---

# Part D — Controls, compliance, and security

## 14. Staff roles and internal controls
The classic restaurant fraud is staff, not diners.
- Role-based permissions for who can void, comp, refund, or override a price.
- Manager PIN for sensitive actions.
- An immutable audit log of every void, comp, refund, and override, with who and when.

## 15. Data protection (Data Protection Act 2019)
Collecting phone numbers, payment data, and loyalty profiles makes the restaurant a data controller.
- Register with the ODPC and capture clear consent for loyalty and marketing.
- Minimize stored data, secure it, and define retention and deletion rules.

## 16. QR tamper protection
A static printed QR is an attack surface: someone can paste a fake code pointing at their own till over your table sticker and skim payments.
- Table codes are validated server-side so a spoofed or altered code fails to open a session.
- Periodic rotation or signed codes for higher-risk locations.

## 17. Full-outage mode
Power and internet both drop in parts of Kenya.
- A degraded manual path lets the floor keep taking orders and payments, with reconciliation into OmniBite once connectivity returns.

---

# Part E — Group scale

## 18. Multi-location and menu engine
- Group master menu with per-location overrides on price and availability.
- Dayparting: different menus and prices by time of day.
- Dynamic pricing: scheduled or rule-based changes.

## 19. Delivery injection
Inject third-party orders into the same kitchen display so the kitchen works one queue.
- Glovo first. It leads the Kenyan market at roughly a third of orders.
- Then Uber Eats and Bolt Food, second and third by share.
- Ignore Jumia Food, which shut down its African operations in December 2023.

## 20. Catering and advance bulk orders
Large orders for events, offices, and functions. A separate subsystem, not the table flow.
- Separate entry point, no table ID. Captures fulfillment type, date and time, quantities, and contact phone.
- Lead-time rules per item and slot capacity caps so the kitchen is never oversold.
- Full prepayment by M-Pesa, with an optional manager approval gate for very large orders.
- Separate production queue scheduled by fulfillment time, kept out of the live a la carte display.
- SMS status updates.

## 21. Back office
- Analytics with per-location and group rollup: sales, item velocity, voids and comps, labor against sales, server performance.
- Inventory depletion tied to sales, with auto-86 when a count hits zero.

---

# Build phases (re-cut)

The earlier plan undersized phase one. A restaurant cannot legally or practically open without tax invoicing, refunds, cash and card, and payment reconciliation. Those move into phase one.

## Phase 1 — Open the doors
The smallest set that is a legal, working restaurant.
- QR table ordering and shared table ordering
- Menu with modifiers and allergens, real-time 86ing
- Pay-before-fire via M-Pesa, with the unhappy-path handling in section 7
- Mixed payment: M-Pesa, cash, and card
- Refunds and failed-order handling
- eTIMS tax invoicing on every sale
- Nightly M-Pesa reconciliation
- Live order tracking
- Kitchen Display System with offline resilience
- Basic staff roles and an audit log for voids, comps, and refunds

## Phase 2 — Harden the floor
- Floor map and full table state
- Server app and call-staff button
- Split payment polish and tipping
- Full role and permission matrix
- QR tamper validation
- Full-outage degraded mode
- SMS receipts, feedback, language toggle

## Phase 3 — Scale the group
- Multi-location menu engine, dayparting, dynamic pricing
- Analytics and inventory
- Loyalty, reservations, and waitlist
- Delivery injection: Glovo, then Uber Eats and Bolt Food
- Catering and advance bulk module

---

# Launch prerequisites (non-build, legal and ops)
These gate go-live and run in parallel with phase one:
- eTIMS onboarding with KRA and a production integration.
- ODPC registration as a data controller and consent language ready.
- M-Pesa Daraja production credentials, paybill or till set up, callbacks live.
- Card gateway merchant account.

---

# Key risk notes
- M-Pesa has no holds. Pay-per-round is mandatory.
- The kitchen display and the ordering path must degrade gracefully offline. Queue locally, sync on reconnect.
- Time estimates come from kitchen queue depth, never a fixed number.
- The differentiation is the table state model, the coursing logic, pay-before-fire, and clean Kenyan compliance. The QR menu itself is a commodity.
