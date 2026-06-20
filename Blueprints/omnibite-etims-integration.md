# OmniBite — eTIMS (KRA) Integration Sequence

How OmniBite issues a legally compliant tax invoice for every sale. This maps onto the `etims_invoices` and `etims_invoice_lines` tables and the eTIMS lifecycle in the state machine.

Like the Daraja doc, treat the field-level detail here as the shape. Exact payloads come from KRA's VSCU or OSCU technical specification for the route you choose, and from your integrator if you use one.

---

## First decision: build direct, or use a licensed integrator

KRA exposes two system-to-system modes, and you do not have to integrate either yourself.

- **OSCU (Online Sales Control Unit)**: always-online, real-time signing. Simplest fit for a cloud POS like OmniBite. Each sale is transmitted and signed as it happens.
- **VSCU (Virtual Sales Control Unit)**: bulk and offline-capable signing. More complex, but it can sign while disconnected and sync later.

Recommendation for OmniBite: **OSCU**, because OmniBite is cloud-hosted and online almost all the time. Handle the rare full outage by queuing the sale and transmitting when connectivity returns, which the async design already does. Choose VSCU only if you decide invoices must be fiscally signed at the edge during an outage.

Second, seriously weigh using a **licensed eTIMS integrator** rather than building direct to KRA. Several are accredited and expose a single `POST /invoice` style API that handles signing, stamping, and transmission for you. Direct integration means KRA accreditation, the full technical spec, and the sandbox certification path yourself. For a phase-one launch on a deadline, an integrator removes weeks of compliance work. Build direct later if you want to own it.

One rule that constrains both paths: **a credit note must be created from the same solution that issued the original invoice.** Do not issue an invoice through one channel and try to reverse it through another.

---

## Step 1 — Onboarding (non-build, gates go-live)
- Register the business and branch for eTIMS via iTax and obtain the credentials for your chosen route.
- Initialize the control unit, which returns the keys and identifiers used to sign and number invoices.
- Run the KRA sandbox: prove normal sales, credit notes, and exceptional cases behave correctly before production certification.

This runs in parallel with the build and is a launch prerequisite, not a feature.

---

## Step 2 — Reference data the invoice needs

Every line must be classifiable, so load and maintain:
- **KRA item classification codes** mapped to your `menu_items.item_code`.
- **Tax categories** per item (for example standard-rated 16 percent VAT versus exempt or zero-rated), stored as `menu_items.tax_rate`.

Get this right once at menu setup and every invoice inherits it.

---

## Step 3 — Transmit an invoice (per confirmed payment)

Triggered when a payment goes CONFIRMED. Build the payload from the payment and its round items:

- Seller PIN (`locations.kra_pin`).
- Buyer PIN, only when the diner wants to claim input tax.
- Invoice type (sale) and the transaction details.
- Line items: description, item classification code, quantity, unit, unit price, tax rate, tax amount.
- Totals: taxable amount, tax amount, gross.

POST it to the OSCU endpoint or your integrator's invoice endpoint. Create the `etims_invoices` row in PENDING with its `etims_invoice_lines`.

---

## Step 4 — KRA signs and stamps

On success KRA returns the fiscal data that makes the invoice legal:
- A **Fiscal Document Number** or invoice identifier, stored in `kra_invoice_no`.
- A **receipt signature** and internal data.
- **QR code data** for verification, stored in `kra_qr_data`.

Set the invoice TRANSMITTED, attach the fiscal number and QR to the diner's SMS receipt. The QR is what a customer or auditor scans to verify the invoice against KRA.

---

## Step 5 — The critical decoupling

**eTIMS transmission must never block firing the kitchen.** The kitchen fires the moment payment is CONFIRMED. Invoice transmission runs asynchronously:
- A worker scans `etims_invoices` where `status IN ('PENDING','FAILED')` and transmits.
- On failure it increments `retry_count`, stores `last_error`, and retries with backoff.
- If KRA is unreachable, the sale still completes and the food still goes out. The invoice transmits once KRA recovers.

The obligation is met either way. The timing is what is async, not the compliance.

---

## Step 6 — Credit notes (refunds)

When a refund resolves, issue an eTIMS **credit note** referencing the original invoice, through the same unit that issued it. Store it as an `etims_invoices` row with `doc_type = 'CREDIT_NOTE'` and link it from the `refunds.credit_note_id`. This keeps the restaurant's tax position consistent with money actually returned.

---

## Go-live checklist
- OSCU route chosen, or an accredited integrator selected and contracted.
- Sandbox certification passed for sales, credit notes, and failure cases.
- Item classification codes and tax categories mapped for the full menu.
- Async transmission worker proven against a simulated KRA outage.
- Fiscal number and QR rendering on the customer receipt.
- Credit-note path proven end to end against a refund.
