# OmniBite — Phase 1 Data Model

Postgres schema for everything in phase one. It maps one-to-one onto the state machine: the enums below are the exact states from that document, so the database and the application speak the same language. Money is `numeric(12,2)` in KES. IDs are UUIDs.

Deferred to later phases and intentionally absent here: loyalty, reservations, delivery injection, catering, and the multi-location menu override engine. `location_id` is carried everywhere so those extend cleanly later.

---

## Enums

```sql
CREATE TYPE session_status   AS ENUM ('ACTIVE','SETTLED','NEEDS_BUSSING','CLOSED');
CREATE TYPE round_status     AS ENUM ('BUILDING','SUBMITTED','AWAITING_PAYMENT','PARTIALLY_PAID','PAID','FIRED','SERVED','CANCELLED');
CREATE TYPE settlement_mode  AS ENUM ('SINGLE_PAYER','SPLIT');
CREATE TYPE round_item_status AS ENUM ('ACTIVE','DROPPED_UNPAID','REFUNDED');
CREATE TYPE payment_method   AS ENUM ('MPESA','CARD','CASH');
CREATE TYPE payment_status   AS ENUM ('INITIATED','PENDING','UNKNOWN','CONFIRMED','FAILED');
CREATE TYPE ticket_status    AS ENUM ('QUEUED','IN_PREP','READY','SERVED');
CREATE TYPE station          AS ENUM ('GRILL','COLD','FRY','PASS');
CREATE TYPE etims_status     AS ENUM ('PENDING','TRANSMITTED','FAILED');
CREATE TYPE etims_doc_type   AS ENUM ('INVOICE','CREDIT_NOTE');
CREATE TYPE refund_status    AS ENUM ('REQUESTED','APPROVED','RESOLVED_CREDIT','REVERSAL_PENDING','REVERSED','REVERSAL_FAILED');
CREATE TYPE staff_role       AS ENUM ('SERVER','MANAGER','KITCHEN','ADMIN');
CREATE TYPE table_floor_state AS ENUM ('OPEN','SEATED','ORDERED','FOOD_RUNNING','PAID','NEEDS_BUSSING');
```

---

## Reference and config

```sql
CREATE TABLE locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid NOT NULL,
  name            text NOT NULL,
  kra_pin         text NOT NULL,          -- seller PIN for eTIMS
  mpesa_shortcode text NOT NULL,          -- paybill or till
  timezone        text NOT NULL DEFAULT 'Africa/Nairobi',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE restaurant_tables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   uuid NOT NULL REFERENCES locations(id),
  table_number  text NOT NULL,
  qr_token      text NOT NULL,            -- signed, server-validated, rotatable
  floor_state   table_floor_state NOT NULL DEFAULT 'OPEN',
  current_session_id uuid,                -- nullable, set while occupied
  UNIQUE (location_id, table_number),
  UNIQUE (qr_token)
);

CREATE TABLE staff (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  uuid NOT NULL REFERENCES locations(id),
  name         text NOT NULL,
  role         staff_role NOT NULL,
  pin_hash     text NOT NULL,
  active       boolean NOT NULL DEFAULT true
);
```

---

## Menu

```sql
CREATE TABLE menu_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   uuid NOT NULL REFERENCES locations(id),
  name          text NOT NULL,
  description   text,
  base_price    numeric(12,2) NOT NULL,
  photo_url     text,
  category      text,
  prep_seconds  int NOT NULL DEFAULT 600, -- feeds the time estimate
  item_code     text NOT NULL,            -- required on the eTIMS invoice line
  tax_rate      numeric(5,2) NOT NULL DEFAULT 16.00,
  is_86         boolean NOT NULL DEFAULT false
);

CREATE TABLE menu_item_allergens (
  menu_item_id  uuid NOT NULL REFERENCES menu_items(id),
  allergen      text NOT NULL,
  PRIMARY KEY (menu_item_id, allergen)
);

CREATE TABLE modifier_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  min_select   int NOT NULL DEFAULT 0,
  max_select   int NOT NULL DEFAULT 1
);

CREATE TABLE modifiers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_group_id uuid NOT NULL REFERENCES modifier_groups(id),
  name              text NOT NULL,
  price_delta       numeric(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE menu_item_modifier_groups (
  menu_item_id      uuid NOT NULL REFERENCES menu_items(id),
  modifier_group_id uuid NOT NULL REFERENCES modifier_groups(id),
  PRIMARY KEY (menu_item_id, modifier_group_id)
);
```

---

## Sessions, rounds, items

```sql
CREATE TABLE table_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id     uuid NOT NULL REFERENCES restaurant_tables(id),
  location_id  uuid NOT NULL REFERENCES locations(id),
  status       session_status NOT NULL DEFAULT 'ACTIVE',
  opened_at    timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);

CREATE TABLE session_participants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES table_sessions(id),
  display_name text,
  phone        text,                      -- nullable; used for receipt and STK push
  device_id    text
);

CREATE TABLE rounds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES table_sessions(id),
  status          round_status NOT NULL DEFAULT 'BUILDING',
  settlement_mode settlement_mode,
  submitted_at    timestamptz,
  paid_at         timestamptz,
  payment_window_expires_at timestamptz   -- drives the unpaid-portion drop in split mode
);

CREATE TABLE round_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id       uuid NOT NULL REFERENCES rounds(id),
  menu_item_id   uuid NOT NULL REFERENCES menu_items(id),
  participant_id uuid NOT NULL REFERENCES session_participants(id), -- who ordered it
  quantity       int NOT NULL DEFAULT 1,
  unit_price     numeric(12,2) NOT NULL,  -- price snapshot at order time
  line_total     numeric(12,2) NOT NULL,
  status         round_item_status NOT NULL DEFAULT 'ACTIVE',
  notes          text
);

CREATE TABLE round_item_modifiers (
  round_item_id uuid NOT NULL REFERENCES round_items(id),
  modifier_id   uuid NOT NULL REFERENCES modifiers(id),
  price_delta   numeric(12,2) NOT NULL,   -- snapshot
  PRIMARY KEY (round_item_id, modifier_id)
);
```

---

## Payments

```sql
CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id       uuid NOT NULL REFERENCES rounds(id),
  participant_id uuid REFERENCES session_participants(id), -- payer; null for staff-recorded cash
  method         payment_method NOT NULL,
  amount         numeric(12,2) NOT NULL,
  status         payment_status NOT NULL DEFAULT 'INITIATED',
  created_at     timestamptz NOT NULL DEFAULT now(),
  confirmed_at   timestamptz
);

CREATE TABLE mpesa_transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          uuid NOT NULL REFERENCES payments(id),
  checkout_request_id text NOT NULL,      -- from STK push
  merchant_request_id text,
  mpesa_receipt       text,               -- idempotency key once paid
  phone               text NOT NULL,
  amount              numeric(12,2) NOT NULL,
  result_code         int,
  result_desc         text,
  callback_at         timestamptz,
  status_query_count  int NOT NULL DEFAULT 0,
  UNIQUE (checkout_request_id)
);
-- Idempotency: a confirmed receipt can only be recorded once.
CREATE UNIQUE INDEX uq_mpesa_receipt ON mpesa_transactions (mpesa_receipt)
  WHERE mpesa_receipt IS NOT NULL;

CREATE TABLE card_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  uuid NOT NULL REFERENCES payments(id),
  gateway_ref text NOT NULL,
  auth_code   text,
  UNIQUE (gateway_ref)
);
-- Cash needs no detail table; method CASH on payments plus the drawer link below.
```

---

## Kitchen

```sql
CREATE TABLE kitchen_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    uuid NOT NULL REFERENCES rounds(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  status      ticket_status NOT NULL DEFAULT 'QUEUED',
  fired_at    timestamptz NOT NULL DEFAULT now(),
  served_at   timestamptz,
  UNIQUE (round_id)                        -- one ticket per round
);

CREATE TABLE kitchen_ticket_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     uuid NOT NULL REFERENCES kitchen_tickets(id),
  round_item_id uuid NOT NULL REFERENCES round_items(id),
  station       station NOT NULL,
  status        ticket_status NOT NULL DEFAULT 'QUEUED'
);
```

---

## eTIMS

```sql
CREATE TABLE etims_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES payments(id),
  location_id     uuid NOT NULL REFERENCES locations(id),
  doc_type        etims_doc_type NOT NULL DEFAULT 'INVOICE',
  status          etims_status NOT NULL DEFAULT 'PENDING',
  seller_pin      text NOT NULL,
  buyer_pin       text,                    -- when the diner claims input tax
  total_amount    numeric(12,2) NOT NULL,
  tax_amount      numeric(12,2) NOT NULL,
  kra_invoice_no  text,
  kra_qr_data     text,
  transmitted_at  timestamptz,
  retry_count     int NOT NULL DEFAULT 0,
  last_error      text
);
-- One tax invoice per payment. Credit notes are separate rows.
CREATE UNIQUE INDEX uq_etims_invoice_per_payment
  ON etims_invoices (payment_id) WHERE doc_type = 'INVOICE';

CREATE TABLE etims_invoice_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES etims_invoices(id),
  description text NOT NULL,
  item_code   text NOT NULL,
  quantity    int NOT NULL,
  unit_price  numeric(12,2) NOT NULL,
  tax_rate    numeric(5,2) NOT NULL,
  tax_amount  numeric(12,2) NOT NULL
);
```

---

## Refunds and store credit

```sql
CREATE TABLE refunds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    uuid NOT NULL REFERENCES payments(id),
  round_item_id uuid REFERENCES round_items(id),  -- null for whole-payment refund
  amount        numeric(12,2) NOT NULL,
  reason_code   text NOT NULL,
  status        refund_status NOT NULL DEFAULT 'REQUESTED',
  requested_by  uuid NOT NULL REFERENCES staff(id),
  approved_by   uuid REFERENCES staff(id),
  credit_note_id uuid REFERENCES etims_invoices(id), -- the CREDIT_NOTE row
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

CREATE TABLE store_credits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone          text NOT NULL,            -- keyed to the diner's M-Pesa number
  source_refund_id uuid REFERENCES refunds(id),
  amount         numeric(12,2) NOT NULL,
  balance        numeric(12,2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
```

---

## Controls and reconciliation

```sql
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,        -- append-only
  location_id uuid NOT NULL REFERENCES locations(id),
  staff_id    uuid REFERENCES staff(id),
  action      text NOT NULL,                -- VOID, COMP, REFUND, PRICE_OVERRIDE, TOGGLE_86
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cash_drawer_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id    uuid NOT NULL REFERENCES locations(id),
  staff_id       uuid NOT NULL REFERENCES staff(id),
  opened_at      timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  opening_float  numeric(12,2) NOT NULL,
  counted_total  numeric(12,2),
  expected_total numeric(12,2),
  variance       numeric(12,2)
);

CREATE TABLE mpesa_reconciliation_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     uuid NOT NULL REFERENCES locations(id),
  run_date        date NOT NULL,
  statement_total numeric(12,2) NOT NULL,
  system_total    numeric(12,2) NOT NULL,
  variance        numeric(12,2) NOT NULL,
  resolved        boolean NOT NULL DEFAULT false,
  UNIQUE (location_id, run_date)
);
```

---

## Enforced invariants

These mirror the state machine. Enforce the structural ones in the schema and the rest in the service layer plus background workers.

- **One ticket per round**: `kitchen_tickets.round_id` is UNIQUE. The service creates the ticket only on the `rounds.status = PAID` transition, so no ticket can exist for an unpaid round.
- **M-Pesa idempotency**: `mpesa_receipt` is unique, so a replayed callback cannot double-record a payment.
- **One tax invoice per payment**: partial unique index on `etims_invoices(payment_id) WHERE doc_type = 'INVOICE'`.
- **No payment rests in PENDING**: a reaper job queries the Daraja status API for any `payments.status IN ('PENDING','UNKNOWN')` older than the timeout and resolves it.
- **eTIMS never blocks firing**: invoice creation is async. The ticket fires on payment confirmation; an `etims_invoices` row in PENDING or FAILED has no effect on the kitchen.
- **Refund integrity**: every `refunds` row links a `credit_note_id` once resolved, and writes an `audit_log` entry.

---

## Key indexes

```sql
CREATE INDEX ix_rounds_session_status   ON rounds (session_id, status);
CREATE INDEX ix_payments_round_status   ON payments (round_id, status);
CREATE INDEX ix_payments_open           ON payments (status) WHERE status IN ('PENDING','UNKNOWN');
CREATE INDEX ix_tickets_board           ON kitchen_tickets (location_id, status);
CREATE INDEX ix_etims_retry             ON etims_invoices (status) WHERE status IN ('PENDING','FAILED');
CREATE INDEX ix_round_items_round       ON round_items (round_id);
```
