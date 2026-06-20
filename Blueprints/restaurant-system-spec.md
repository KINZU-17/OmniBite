# Restaurant QR Ordering and Payment System
## Feature Specification

A custom dine-in ordering, kitchen, and payment platform for multi-location restaurant groups in Kenya. Diners order from their table by QR, pay by M-Pesa before the kitchen cooks, track their order live, and leave without flagging down a waiter. The design removes dine-and-dash structurally rather than policing it after the fact.

Context assumptions: Kenya, M-Pesa via the Daraja API, casual sit-down dining, web-based with no app download for diners.

---

## 1. Core dine-in flow

The spine every order passes through.

- **QR per table.** Each code encodes location ID plus table ID. The diner scans, lands on that location's live menu, and joins that table's session. No app download.
- **Order to kitchen.** Placed items become a ticket carrying the table ID, routed to the Kitchen Display System.
- **Pay before fire.** The kitchen ticket fires only after M-Pesa confirms payment. No payment, no food. This is the anti dine-and-dash spine, detailed in section 3.
- **Live tracking.** The diner's screen moves through received, preparing, and ready, with a time estimate that updates from the kitchen's real queue depth, not a fixed promise.
- **Real-time 86ing.** When the kitchen marks an item out of stock, it greys out across every active and incoming order at that location within seconds.

---

## 2. Shared table ordering (multiple diners, different meals)

Several people at one table, each ordering different meals, combined into one table ticket.

- Everyone who scans the same table QR joins one shared session tied to that table ID.
- Each diner adds their own items from their own phone. Every item is tagged to the person who ordered it, which is what later makes split payment work.
- Each diner pays their own portion by M-Pesa STK push against the shared table ID.
- The kitchen **holds and fires the whole table as one coursed ticket** once the round is paid, so the table eats together instead of dishes trickling out per person.
- Later additions (a dessert, another round) open a new paid round on the same session.

This keeps pay-before-fire intact: the kitchen still only cooks paid food, but the coursing logic restores the shared-meal experience.

---

## 3. Payment and security (M-Pesa Daraja)

The security lives here, not in staff vigilance.

- **Mechanism.** Placing an order triggers an STK push (Lipa na M-Pesa Online) to the diner's phone. They enter their M-Pesa PIN. The Daraja callback returns the amount and a reference.
- **Table link.** The table ID rides in the account reference field. The callback matches payment to table, marks the order paid, fires the kitchen ticket, and updates the front desk floor map.
- **Dine-and-dash prevention.** Because food only cooks after payment confirms, there is never unpaid food on a table. The risk is removed by design.
- **M-Pesa constraint.** M-Pesa has no card-style pre-authorization or hold. Any design that depends on reserving money against an open tab will not work. Pay-per-round is the model that matches the rails.
- **Split payment.** Multiple diners each fire their own STK push against the same table ID. The table clears only when the total is covered.
- **Tipping.** Added on top of the order and paid in the same push.
- **Optional relaxed mode.** For venues that want settle-at-the-end dining, an open tab can start with a small M-Pesa deposit, with the front desk floor map flagging any table whose bill exceeds what's been paid. Higher risk, staff-watched. Build only if a venue asks.

---

## 4. Kitchen operations

- **Kitchen Display System.** Tickets split by station (grill, cold, fry, pass), age in real time, bump when done. Replaces paper.
- **Coursing and holds.** Apps fire now, mains fire on a server signal or timer. Shared table tickets fire as one unit.
- **Pacing.** Ticket throttling during a rush so the line doesn't get buried, with per-station load balancing.
- **Offline resilience.** The kitchen display queues tickets locally and syncs when connectivity returns. A paid ticket must never be lost to a dropped link.

---

## 5. Front desk and floor

- **Table state as source of truth.** Open, seated, ordered, food running, check dropped, paid, needs bussing. Drives everything else.
- **Floor map.** Shows every table's state at a glance, including paid vs unpaid.
- **Server app.** Staff run the same table state, so QR orders and server-entered orders land in one tab with no reconciliation.
- **Call-staff button.** QR removes the waiter, so diners still need a way to summon one for water or help. It pings the floor map, not the kitchen.
- **Reservations and waitlist.** Booking and waitlist with SMS notifications, feeding the same table state.

---

## 6. Multi-location and menu engine

- **Group master with per-location overrides.** The group shares a menu spine, each location overrides price and availability.
- **Dayparting.** Different menus and prices by time of day (breakfast, lunch, happy hour).
- **Dynamic pricing.** Scheduled or rule-based price changes.

---

## 7. Diner experience extras

- **Item-level feedback** tied to the exact order and ticket, so a complaint points the kitchen at the specific dish.
- **SMS receipt** to the diner's phone, separate from the M-Pesa confirmation.
- **English and Swahili** menu toggle.
- **Loyalty and CRM** keyed to the M-Pesa phone number, so a returning diner's favorites and allergies surface on their tab.

---

## 8. Catering and advance bulk orders

Large orders for events, offices, and functions. A separate subsystem, not the table flow.

- **Separate entry point**, no table ID. Captures fulfillment type (pickup or delivery), date and time, quantities, and contact phone.
- **Lead-time rules per item.** A cake needs 24 hours, thirty hot plates need three. The system blocks any slot the kitchen can't hit.
- **Slot capacity caps.** Each time window holds only as many bulk orders as the kitchen can produce alongside normal service. Full slots close.
- **Full prepayment by M-Pesa**, no exceptions. Bulk commits real ingredient cost upfront.
- **Separate production queue** scheduled by fulfillment time, kept out of the live a la carte kitchen display.
- **SMS status updates** (confirmed, in production, ready or out for delivery).
- **Optional manager approval gate** for very large orders before the M-Pesa push goes out.

---

## 9. Delivery integration

Inject third-party delivery orders into the same kitchen display so the kitchen works one queue.

- **Glovo first.** It leads the Kenyan market at roughly a third of orders.
- **Then Uber Eats and Bolt Food.** Second and third by share.
- Ignore Jumia Food. It shut down its African operations in December 2023.

---

## 10. Back office

- **Analytics** with per-location and group rollup: sales, item velocity, voids and comps, labor against sales, server performance.
- **Inventory** depletion tied to sales, with auto-86 when a count hits zero so the floor never sells what the kitchen doesn't have.

---

## 11. Build phases

The full set is the target, but it ships in phases or it doesn't ship.

**Phase 1, a working restaurant.** QR order to kitchen, shared table ordering, pay-before-fire via M-Pesa, live tracking, real-time 86ing.

**Phase 2, the floor.** Table state and floor map, server app, call-staff button, item feedback, split payment, tipping.

**Phase 3, the group.** Multi-location menu engine, dayparting and dynamic pricing, analytics, inventory, loyalty, reservations and waitlist, delivery injection, catering and bulk module.

---

## 12. Key technical and risk notes

- M-Pesa has no holds or pre-auth. Pay-per-round is mandatory, not a preference.
- The kitchen display must degrade gracefully offline. Queue locally, sync on reconnect.
- Time estimates must come from kitchen queue depth, never a fixed or customer-set number.
- If a map provider is added later: Glovo and delivery handle their own routing, so the only in-house map need is a static store locator. That needs neither Mapbox nor Google heavily. If driver tracking is built in-house, Mapbox is cheaper but has no hard spending cap, so set a usage ceiling in code.
- The differentiation is the table state model, the coursing logic, and pay-before-fire on M-Pesa. The QR menu itself is a commodity.
