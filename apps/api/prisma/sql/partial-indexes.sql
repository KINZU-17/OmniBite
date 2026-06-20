-- OmniBite partial indexes — apply AFTER `prisma migrate` / `prisma db push`.
-- Prisma cannot express partial indexes (WHERE clauses) in schema.prisma, so these three
-- constructs from the Phase 1 data model are maintained here and must be run against the database
-- once the base schema exists. When the first real migration is created, paste these into it so
-- they are tracked by Prisma Migrate.

-- Invariant: exactly one tax INVOICE per payment (credit notes share payment_id and are excluded).
CREATE UNIQUE INDEX IF NOT EXISTS uq_etims_invoice_per_payment
  ON etims_invoices (payment_id) WHERE doc_type = 'INVOICE';

-- Hot path for the M-Pesa reaper: open payments awaiting resolution.
CREATE INDEX IF NOT EXISTS ix_payments_open
  ON payments (status) WHERE status IN ('PENDING', 'UNKNOWN');

-- Hot path for the eTIMS retry worker: invoices still to transmit.
CREATE INDEX IF NOT EXISTS ix_etims_retry
  ON etims_invoices (status) WHERE status IN ('PENDING', 'FAILED');
