# OmniBite

A QR-based dine-in **ordering, kitchen, and payment platform** for multi-location restaurant
groups in **Kenya**. A product by Omnilab. Diners scan a table QR, order from their phone,
**pay by M-Pesa before the kitchen cooks**, track the order live, and leave without flagging a
waiter. Dine-and-dash is removed structurally, and Kenyan tax/payment/data law is treated as a
core requirement, not an afterthought.

> **Status (2026-06):** Phase 1 backend complete (NestJS + Prisma 6) and two Phase 1 frontends built
> (diner ordering PWA, KDS PWA) — all type-checks, the API builds, and 20 unit tests pass. Not yet
> run end-to-end against a live Postgres (none/Docker in this environment). Floor map, server app, and
> admin dashboard are Phase 2/3.

## Repository layout (npm workspaces monorepo)
```
OmniBite/
├─ CLAUDE.md                    # this file
├─ package.json                # workspaces root (apps/*, packages/*)
├─ docker-compose.yml          # local Postgres + Redis (needs Docker)
├─ Blueprints/                 # the specs (source of truth)
│  ├─ omnibite-complete-spec.md
│  └─ docs/…                   # individual spec sources (consolidated into the above)
├─ packages/
│  └─ shared/  (@omnibite/shared)   # socket events, room helpers, status types
└─ apps/
   ├─ api/    (@omnibite/api)  # NestJS + Prisma; one folder per feature module
   │  ├─ prisma/schema.prisma  # Phase 1 data model (mirrors the spec DDL 1:1)
   │  ├─ prisma/sql/partial-indexes.sql   # partial indexes Prisma can't express
   │  ├─ prisma/seed.ts        # dev seed (location, tables, menu, staff)
   │  └─ src/{gate,sessions,rounds,payments,mpesa,kitchen,etims,refunds,recon,menu,realtime,audit,auth,common}/
   ├─ web/    (@omnibite/web)  # diner QR ordering + tracking PWA (Vite/React/Tailwind)
   └─ kds/    (@omnibite/kds)  # Kitchen Display PWA (Vite/React/Tailwind)
```
`gate/` holds `SettlementService` — the PAID gate that atomically creates the ticket + per-payer
eTIMS invoices + flips the floor, then emits `round.paid`.

## Local development
```bash
npm install                          # from repo root; links all workspaces
npm run build:shared                 # build @omnibite/shared first (api/web/kds depend on its dist)
docker compose up -d                 # Postgres :5432, Redis :6379 (Docker not installed here)

# Backend
cp apps/api/.env.example apps/api/.env   # fill M-Pesa/eTIMS creds when available
npm run db:push   --workspace @omnibite/api    # apply schema to a fresh DB
psql "$DATABASE_URL" -f apps/api/prisma/sql/partial-indexes.sql   # then the partial indexes
npm run prisma:seed --workspace @omnibite/api  # seed dev data (prints QR tokens + staff ids)
npm run dev:api                      # API on :3000

# Frontends (set VITE_API_URL if not http://localhost:3000)
npm run dev:web                      # diner PWA on :5173  → open /t/<qrToken>
npm run dev:kds                      # KDS PWA on :5174    → enter locationId + KITCHEN staff id
```
The API connects to Postgres on boot, so a running DB is required to start it. `npm run build`
(root) type-checks shared + api without a database; `npm test` runs the API unit tests.

## Context that applies everywhere
- **Country:** Kenya. Currency KES. Timezone `Africa/Nairobi`.
- **Payments:** M-Pesa via the **Daraja** API (primary), plus card and cash.
- **Tax:** real-time electronic invoicing to **KRA via eTIMS** is legally mandatory on every sale.
- **Dining:** casual sit-down. **Web-based, no app download for diners.**
- **Backend store:** Postgres.

## The one rule everything protects
**The kitchen never receives a ticket for an unpaid round.** Food only fires after payment
confirms. Every design decision is in service of this.

## Documentation map
All specs live under `Blueprints/`. The single consolidated reference is:

- **`Blueprints/omnibite-complete-spec.md`** — read this first. It folds in everything below in order:
  1. Feature spec + three-phase plan
  2. Phase 1 order/payment **state machine**
  3. Phase 1 **Postgres data model** (DDL)
  4. **M-Pesa (Daraja)** integration sequence
  5. **eTIMS (KRA)** integration sequence
  6. Real-time layer & **KDS** (Socket.io)

The individual source files under `Blueprints/docs/` (plus `Blueprints/restaurant-system-spec.md`)
are consolidated into the complete spec; prefer the complete spec to avoid drift.

> **Integration caveat:** in the Daraja and eTIMS docs, exact API field names and result codes are
> "the shape, not gospel." Confirm against Safaricom's current Daraja docs and KRA's VSCU/OSCU spec
> (or your integrator) before coding. The flows are stable; the specific strings drift.

## Core domain model (six lifecycles)
1. **Table Session** — one per occupied table; holds Rounds. `ACTIVE → SETTLED → NEEDS_BUSSING → CLOSED`.
2. **Round** — a batch of items submitted and paid together; the unit of pay-before-fire.
   `BUILDING → SUBMITTED → AWAITING_PAYMENT → (PARTIALLY_PAID) → PAID → FIRED → SERVED`, or `CANCELLED`.
3. **Payment** — one per payer per round (M-Pesa / card / cash). All converge to `CONFIRMED` or `FAILED`; nothing rests in pending.
4. **Kitchen Ticket** — created **only** when a Round reaches `PAID`. `QUEUED → IN_PREP → READY → SERVED`. One ticket per round.
5. **eTIMS Invoice** — one per **confirmed payment** (so a split round yields one invoice per payer). Async; never blocks firing.
6. **Refund** — when paid food can't be delivered or is rejected. Store credit is the default remedy; M-Pesa reversal is the fallback. Every refund → eTIMS credit note + audit log entry.

Reaching `PAID` does three things at once: creates the kitchen ticket, queues the eTIMS invoice per
payment, and updates the floor map. Settlement mode is `SINGLE_PAYER` or `SPLIT`; in split mode a
payment window drops unpaid portions on expiry so the table is never held hostage.

## Invariants (must always hold)
1. No kitchen ticket exists for a round that is not `PAID`.
2. Every `CONFIRMED` payment produces exactly one eTIMS invoice, **idempotently**.
3. **eTIMS transmission never blocks firing the kitchen** (async with retry/backoff).
4. Every M-Pesa payment resolves to `CONFIRMED` or `FAILED` — none stays `PENDING` (status-query reaper backstop).
5. Every refund produces an eTIMS credit note and an audit log entry.
6. A session cannot close while any round is non-terminal.
7. An 86'd item can never enter a `BUILDING` round; if 86'd after payment, it is auto-refunded.

Structural invariants are enforced in the schema (e.g. `kitchen_tickets.round_id` UNIQUE; unique
`mpesa_receipt`; partial unique index on `etims_invoices(payment_id) WHERE doc_type='INVOICE'`); the
rest live in the service layer and background workers.

## Phase plan
- **Phase 1 — Open the doors (legal, working restaurant):** QR + shared-table ordering; menu with
  modifiers/allergens + real-time 86ing; pay-before-fire via M-Pesa with full unhappy-path handling;
  mixed payment (M-Pesa/cash/card); refunds; **eTIMS on every sale**; nightly M-Pesa reconciliation;
  live tracking; KDS with offline resilience; basic staff roles + audit log.
- **Phase 2 — Harden the floor:** floor map + table state, server app, call-staff, split/tip polish,
  full role matrix, QR tamper validation, full-outage degraded mode, SMS receipts/feedback/language.
- **Phase 3 — Scale the group:** multi-location menu engine + dayparting + dynamic pricing,
  analytics + inventory, loyalty, reservations/waitlist, delivery injection (Glovo → Uber Eats → Bolt
  Food), catering/bulk module.

The Phase 1 data model deliberately omits loyalty, reservations, delivery, catering, and the
multi-location override engine, but carries `location_id` everywhere so they extend cleanly later.

## Tech stack
- **Backend:** **NestJS (Node + TypeScript)**, **Prisma 6** (pinned — not 7; v7's ESM driver-adapter
  fights Nest's CommonJS runtime). `@nestjs/schedule` for the reaper/eTIMS/recon crons,
  `@nestjs/event-emitter` for the in-process `round.paid` side effects.
- **Frontend:** **React 19 + Vite + Tailwind v4** (`@tailwindcss/vite`), `socket.io-client`,
  TanStack Query. Diner app + KDS are installable PWAs via a manifest + a small app-shell service
  worker (no heavyweight plugin). Both import `@omnibite/shared`.
- **Real-time:** **Socket.io** over WebSockets. Postgres is the source of truth; sockets are delivery,
  not memory. Per-location rooms (`location:{id}:kitchen`, `location:{id}:floor`), authenticated on
  connect, no wildcard CORS in prod. **Redis** adapter (wired only when `REDIS_URL` is set) for
  multi-instance fan-out.
- **Database:** Postgres. Money is `Decimal(12,2)` in KES; IDs are UUIDs.

## Launch prerequisites (non-build, gate go-live, run in parallel)
- eTIMS onboarding with KRA + production integration (OSCU recommended for cloud POS; or a licensed integrator).
- ODPC registration as a data controller + consent language.
- M-Pesa Daraja production credentials, paybill/till, live callbacks.
- Card gateway merchant account.

## Working conventions
- Enum values in code/DB use the **exact** state names from the state machine (e.g. `AWAITING_PAYMENT`,
  `PARTIALLY_PAID`) so the database and application speak the same language.
- Build and test M-Pesa against the Daraja **sandbox** (`https://sandbox.safaricom.co.ke`) before
  production (`https://api.safaricom.co.ke`). Cache the OAuth token (~1h); don't fetch one per request.
- M-Pesa callbacks: acknowledge with 200 fast, do heavy work then ack; dedupe on `mpesa_receipt`.
- A credit note must be issued through the **same** eTIMS solution that issued the original invoice.
- Phase 1 staff auth is the `x-staff-id` header (+ `RolesGuard`); signed tokens and the full
  permission matrix are Phase 2. Sockets authenticate on connect via `auth.staffId` / `auth.locationId`.
- Git is initialized (branch `main`); nothing is committed yet — commit when you're ready.
- When a type from `@prisma/client` is used in a decorated controller/handler signature, import it
  with `import type` (isolatedModules + emitDecoratorMetadata).
