import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { bootstrap, resetDb, seedFixtures, type Fixtures } from './helpers';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * The one rule: no kitchen ticket for an unpaid round. This drives the full
 * cash path through the real HTTP + DB stack and asserts invariants 1, 2, 3, 6
 * plus the idempotency of a replayed confirm.
 */
describe('PAID gate (pay-before-fire)', () => {
  let app!: INestApplication;
  let prisma!: PrismaService;
  let fx!: Fixtures;

  beforeAll(async () => {
    ({ app, prisma } = await bootstrap());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(prisma);
    fx = await seedFixtures(prisma);
  });

  const api = () => request(app.getHttpServer());

  it('fires only after payment, idempotently, then auto-settles on serve', async () => {
    const scan = await api()
      .post('/sessions/scan')
      .send({ qrToken: fx.table.qrToken, displayName: 'E2E', phone: '254700000000' })
      .expect(201);
    const sessionId: string = scan.body.sessionId;
    const participantId: string = scan.body.participant.id;
    expect(sessionId).toBeTruthy();

    const round = await api().post(`/sessions/${sessionId}/round`).expect(201);
    const roundId: string = round.body.id;
    await api()
      .post(`/rounds/${roundId}/items`)
      .send({ menuItemId: fx.items.fries.id, participantId, quantity: 2 })
      .expect(201);

    const submit = await api()
      .post(`/rounds/${roundId}/submit`)
      .send({ settlementMode: 'SINGLE_PAYER', payments: [{ participantId, method: 'CASH' }] })
      .expect(201);
    const payment = submit.body.payments[0];
    expect(Number(payment.amount)).toBe(700); // 2 × 350

    // INVARIANT 1: no ticket before payment.
    expect(await prisma.kitchenTicket.findUnique({ where: { roundId } })).toBeNull();
    expect(
      (await prisma.round.findUniqueOrThrow({ where: { id: roundId } })).status,
    ).toBe('AWAITING_PAYMENT');

    // Record cash → PAID gate fires.
    const cash = await api()
      .post(`/payments/${payment.id}/cash`)
      .set('x-staff-id', fx.staff.server.id)
      .expect(201);
    expect(cash.body.fired).toBe(true);

    expect((await prisma.round.findUniqueOrThrow({ where: { id: roundId } })).status).toBe('FIRED');
    const ticket = await prisma.kitchenTicket.findUnique({
      where: { roundId },
      include: { lines: true },
    });
    expect(ticket).not.toBeNull();
    expect(ticket!.lines).toHaveLength(1);

    // INVARIANT 2 + 3: exactly one eTIMS invoice, PENDING (never blocked firing).
    const invoices = await prisma.etimsInvoice.findMany({
      where: { paymentId: payment.id, docType: 'INVOICE' },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('PENDING');

    expect(
      (await prisma.restaurantTable.findUniqueOrThrow({ where: { id: fx.table.id } })).floorState,
    ).toBe('PAID');

    // Idempotency: a replayed confirm must not re-fire or duplicate.
    const cash2 = await api()
      .post(`/payments/${payment.id}/cash`)
      .set('x-staff-id', fx.staff.server.id)
      .expect(201);
    expect(cash2.body.fired).toBe(false);
    expect(await prisma.kitchenTicket.count({ where: { roundId } })).toBe(1);
    expect(
      await prisma.etimsInvoice.count({ where: { paymentId: payment.id, docType: 'INVOICE' } }),
    ).toBe(1);

    // Serve → SERVED and the session auto-settles (invariant 6 path).
    await api()
      .post(`/kitchen/tickets/${ticket!.id}/serve`)
      .set('x-staff-id', fx.staff.kitchen.id)
      .expect(201);
    expect((await prisma.round.findUniqueOrThrow({ where: { id: roundId } })).status).toBe('SERVED');
    expect(
      (await prisma.tableSession.findUniqueOrThrow({ where: { id: sessionId } })).status,
    ).toBe('SETTLED');
  });
});
