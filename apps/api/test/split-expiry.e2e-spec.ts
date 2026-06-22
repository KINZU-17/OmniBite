import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { bootstrap, resetDb, seedFixtures, type Fixtures } from './helpers';
import { RoundsService } from '../src/rounds/rounds.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * Split-payment window expiry: a table is never held hostage by one non-payer.
 * Two diners split a round; only one pays. When the window lapses, the reaper
 * drops the unpaid portion and fires the rest.
 */
describe('Split-payment window expiry', () => {
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

  it('drops the unpaid diner and fires the paid portion', async () => {
    // Diner A scans; diner B joins the same table session.
    const scan = await api()
      .post('/sessions/scan')
      .send({
        qrToken: fx.table.qrToken,
        displayName: 'Ann',
        phone: '254700000001',
      })
      .expect(201);
    const scanBody = scan.body as {
      sessionId: string;
      participant: { id: string };
    };
    const sessionId: string = scanBody.sessionId;
    const aId: string = scanBody.participant.id;

    await api()
      .post(`/sessions/${sessionId}/join`)
      .send({ displayName: 'Ben', phone: '254700000002' })
      .expect(201);
    const ben = await prisma.sessionParticipant.findFirstOrThrow({
      where: { sessionId, displayName: 'Ben' },
    });
    const bId = ben.id;

    // A orders Fries (350), B orders Soda (200).
    const round = await api().post(`/sessions/${sessionId}/round`).expect(201);
    const roundBody = round.body as { id: string };
    const roundId: string = roundBody.id;
    await api()
      .post(`/rounds/${roundId}/items`)
      .send({ menuItemId: fx.items.fries.id, participantId: aId, quantity: 1 })
      .expect(201);
    await api()
      .post(`/rounds/${roundId}/items`)
      .send({ menuItemId: fx.items.soda.id, participantId: bId, quantity: 1 })
      .expect(201);

    // SPLIT submit: one cash instruction per payer.
    const submit = await api()
      .post(`/rounds/${roundId}/submit`)
      .send({
        settlementMode: 'SPLIT',
        payments: [
          { participantId: aId, method: 'CASH' },
          { participantId: bId, method: 'CASH' },
        ],
      })
      .expect(201);
    const submitBody = submit.body as {
      payments: Array<{
        id: string;
        participantId: string;
        amount: number | string;
      }>;
    };
    const payA = submitBody.payments.find((p) => p.participantId === aId)!;
    expect(Number(payA.amount)).toBe(350);

    // Only A pays → round is PARTIALLY_PAID (B still owes).
    const cash = await api()
      .post(`/payments/${payA.id}/cash`)
      .set('x-staff-id', fx.staff.server.id)
      .expect(201);
    const cashBody = cash.body as { fired: boolean };
    expect(cashBody.fired).toBe(false);
    expect(
      (await prisma.round.findUniqueOrThrow({ where: { id: roundId } })).status,
    ).toBe('PARTIALLY_PAID');

    // Force the window into the past and run the reaper directly.
    await prisma.round.update({
      where: { id: roundId },
      data: { paymentWindowExpiresAt: new Date(Date.now() - 1000) },
    });
    await app.get(RoundsService).reapExpiredWindows();

    // The round fired with only A's item; B's item was dropped.
    expect(
      (await prisma.round.findUniqueOrThrow({ where: { id: roundId } })).status,
    ).toBe('FIRED');
    const items = await prisma.roundItem.findMany({ where: { roundId } });
    const aItem = items.find((i) => i.participantId === aId)!;
    const bItem = items.find((i) => i.participantId === bId)!;
    expect(aItem.status).toBe('ACTIVE');
    expect(bItem.status).toBe('DROPPED_UNPAID');

    const ticket = await prisma.kitchenTicket.findUnique({
      where: { roundId },
      include: { lines: true },
    });
    expect(ticket!.lines).toHaveLength(1); // only A's fries fired
    // One invoice for the payer who actually paid.
    expect(
      await prisma.etimsInvoice.count({
        where: { paymentId: payA.id, docType: 'INVOICE' },
      }),
    ).toBe(1);
  });
});
