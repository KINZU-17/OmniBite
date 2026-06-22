/**
 * End-to-end happy path against a running API + Postgres, using the CASH
 * settlement path so it needs no external M-Pesa/eTIMS. Proves the core
 * invariants: no ticket before PAID, the PAID gate fires the ticket + queues one
 * eTIMS invoice per payment + flips the floor, idempotent confirm, and serve →
 * SERVED → session auto-settles. Run with ts-node after the API is up.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`, extra ?? '');
  }
}

async function http<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...opts,
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `${opts.method ?? 'GET'} ${path} -> ${res.status}: ${text}`,
    );
  return (text ? JSON.parse(text) : undefined) as T;
}

async function main() {
  const location = await prisma.location.findFirstOrThrow();
  const table = await prisma.restaurantTable.findFirstOrThrow({
    where: { locationId: location.id },
  });
  const server = await prisma.staff.findFirstOrThrow({
    where: { locationId: location.id, role: 'SERVER' },
  });
  const kitchen = await prisma.staff.findFirstOrThrow({
    where: { locationId: location.id, role: 'KITCHEN' },
  });
  const item = await prisma.menuItem.findFirstOrThrow({
    where: { locationId: location.id, name: 'Fries' },
  });

  console.log('\n1. Scan QR → session');
  const scan = await http<{
    sessionId: string;
    participant: { id: string };
    locationId: string;
  }>('/sessions/scan', {
    method: 'POST',
    body: JSON.stringify({
      qrToken: table.qrToken,
      displayName: 'E2E',
      phone: '254700000000',
    }),
  });
  check(
    'scan returns a session + participant',
    !!scan.sessionId && !!scan.participant?.id,
  );

  console.log('2. Build a round and add an item');
  const round = await http<{ id: string }>(
    `/sessions/${scan.sessionId}/round`,
    { method: 'POST' },
  );
  await http(`/rounds/${round.id}/items`, {
    method: 'POST',
    body: JSON.stringify({
      menuItemId: item.id,
      participantId: scan.participant.id,
      quantity: 2,
    }),
  });

  console.log('3. Submit (CASH, single payer)');
  const submit = await http<{
    payments: { id: string; amount: string; method: string }[];
  }>(`/rounds/${round.id}/submit`, {
    method: 'POST',
    body: JSON.stringify({
      settlementMode: 'SINGLE_PAYER',
      payments: [{ participantId: scan.participant.id, method: 'CASH' }],
    }),
  });
  const payment = submit.payments[0];
  check(
    'one payment created, amount = 2 × 350 = 700',
    payment?.method === 'CASH' && Number(payment.amount) === 700,
    payment,
  );

  const before = await prisma.kitchenTicket.findUnique({
    where: { roundId: round.id },
  });
  check('INVARIANT 1: no kitchen ticket before payment', before === null);
  const awaiting = await prisma.round.findUniqueOrThrow({
    where: { id: round.id },
  });
  check(
    'round is AWAITING_PAYMENT before cash',
    awaiting.status === 'AWAITING_PAYMENT',
    awaiting.status,
  );

  console.log('4. Record cash → PAID gate fires');
  const confirm = await http<{ fired: boolean }>(
    `/payments/${payment.id}/cash`,
    {
      method: 'POST',
      headers: { 'x-staff-id': server.id },
    },
  );
  check('cash confirm fired the round', confirm.fired === true);

  const round2 = await prisma.round.findUniqueOrThrow({
    where: { id: round.id },
  });
  check('round is FIRED', round2.status === 'FIRED', round2.status);

  const ticket = await prisma.kitchenTicket.findUnique({
    where: { roundId: round.id },
    include: { lines: true },
  });
  check('exactly one kitchen ticket for the round', !!ticket);
  check(
    'ticket has one line (one round item)',
    ticket?.lines.length === 1,
    ticket?.lines.length,
  );

  const invoices = await prisma.etimsInvoice.findMany({
    where: { paymentId: payment.id, docType: 'INVOICE' },
  });
  check(
    'INVARIANT 2: exactly one eTIMS invoice for the payment',
    invoices.length === 1,
    invoices.length,
  );
  check(
    'INVARIANT 3: invoice is PENDING (eTIMS never blocked firing)',
    invoices[0]?.status === 'PENDING',
    invoices[0]?.status,
  );

  const tableAfter = await prisma.restaurantTable.findUniqueOrThrow({
    where: { id: table.id },
  });
  check(
    'floor state flipped to PAID',
    tableAfter.floorState === 'PAID',
    tableAfter.floorState,
  );

  console.log('5. Idempotency: record cash again');
  const confirm2 = await http<{ fired: boolean }>(
    `/payments/${payment.id}/cash`,
    {
      method: 'POST',
      headers: { 'x-staff-id': server.id },
    },
  );
  check('second cash confirm does NOT re-fire', confirm2.fired === false);
  const ticketCount = await prisma.kitchenTicket.count({
    where: { roundId: round.id },
  });
  check(
    'still exactly one ticket after replay',
    ticketCount === 1,
    ticketCount,
  );

  console.log('6. KDS board + serve');
  const board = await http<{ id: string; roundId: string }[]>(
    `/locations/${location.id}/kitchen/board`,
    { headers: { 'x-staff-id': kitchen.id } },
  );
  const boardTicket = board.find((t) => t.roundId === round.id);
  check('ticket appears on the kitchen board', !!boardTicket);

  await http(`/kitchen/tickets/${boardTicket!.id}/serve`, {
    method: 'POST',
    headers: { 'x-staff-id': kitchen.id },
  });
  const round3 = await prisma.round.findUniqueOrThrow({
    where: { id: round.id },
  });
  check(
    'round is SERVED after serve',
    round3.status === 'SERVED',
    round3.status,
  );
  const session = await prisma.tableSession.findUniqueOrThrow({
    where: { id: scan.sessionId },
  });
  check(
    'INVARIANT 6 path: session auto-settled (no open rounds)',
    session.status === 'SETTLED',
    session.status,
  );

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('E2E error:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
