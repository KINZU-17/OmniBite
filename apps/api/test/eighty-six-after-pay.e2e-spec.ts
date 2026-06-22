import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { bootstrap, resetDb, seedFixtures, type Fixtures } from './helpers';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * Invariant 7 (the paid half): an item 86'd after it was paid for and fired is
 * auto-refunded as store credit, with a credit note — the diner never loses
 * money for food the kitchen can no longer make.
 */
describe('86 after payment → auto-refund', () => {
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

  it('auto-refunds a fired item when it is 86ed', async () => {
    const scan = await api()
      .post('/sessions/scan')
      .send({
        qrToken: fx.table.qrToken,
        displayName: 'Eli',
        phone: '254700000444',
      })
      .expect(201);
    const scanBody = scan.body as {
      sessionId: string;
      participant: { id: string };
    };
    const sessionId: string = scanBody.sessionId;
    const participantId: string = scanBody.participant.id;

    const round = await api().post(`/sessions/${sessionId}/round`).expect(201);
    const roundBody = round.body as { id: string };
    const roundId: string = roundBody.id;
    const add = await api()
      .post(`/rounds/${roundId}/items`)
      .send({ menuItemId: fx.items.fries.id, participantId, quantity: 1 })
      .expect(201);
    const addBody = add.body as { id: string };
    const roundItemId: string = addBody.id;

    const submit = await api()
      .post(`/rounds/${roundId}/submit`)
      .send({
        settlementMode: 'SINGLE_PAYER',
        payments: [{ participantId, method: 'CASH' }],
      })
      .expect(201);
    const submitBody = submit.body as { payments: Array<{ id: string }> };
    const paymentId: string = submitBody.payments[0].id;
    await api()
      .post(`/payments/${paymentId}/cash`)
      .set('x-staff-id', fx.staff.server.id)
      .expect(201);
    expect(
      (await prisma.round.findUniqueOrThrow({ where: { id: roundId } })).status,
    ).toBe('FIRED');

    // 86 the Fries (kitchen) → the fired item is auto-refunded inside the handler.
    await api()
      .patch(`/menu-items/${fx.items.fries.id}/availability`)
      .set('x-staff-id', fx.staff.kitchen.id)
      .send({ is86: true })
      .expect(200);

    // The round item is marked refunded.
    expect(
      (await prisma.roundItem.findUniqueOrThrow({ where: { id: roundItemId } }))
        .status,
    ).toBe('REFUNDED');

    // A refund was created with the auto-refund reason, plus a credit note.
    const refund = await prisma.refund.findFirstOrThrow({
      where: { roundItemId },
    });
    expect(refund.reasonCode).toBe('ITEM_86_AFTER_PAID');
    expect(['RESOLVED_CREDIT', 'REVERSAL_PENDING']).toContain(refund.status);
    expect(
      await prisma.etimsInvoice.count({
        where: { paymentId, docType: 'CREDIT_NOTE' },
      }),
    ).toBe(1);
  });
});
