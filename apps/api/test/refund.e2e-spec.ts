import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { bootstrap, resetDb, seedFixtures, type Fixtures } from './helpers';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * Refund path (invariant 5): every refund produces an eTIMS credit note and an
 * audit entry. Store credit is the default remedy and is issued to the payer's
 * phone. Walks request → approve → resolve(CREDIT) end-to-end.
 */
describe('Refund → credit note + store credit + audit', () => {
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

  async function firedPayment(): Promise<{ paymentId: string; phone: string }> {
    const phone = '254700000123';
    const scan = await api()
      .post('/sessions/scan')
      .send({ qrToken: fx.table.qrToken, displayName: 'Refund', phone })
      .expect(201);
    const sessionId: string = scan.body.sessionId;
    const participantId: string = scan.body.participant.id;
    const round = await api().post(`/sessions/${sessionId}/round`).expect(201);
    await api()
      .post(`/rounds/${round.body.id}/items`)
      .send({ menuItemId: fx.items.fries.id, participantId, quantity: 1 })
      .expect(201);
    const submit = await api()
      .post(`/rounds/${round.body.id}/submit`)
      // Attach the participant so the refund has a phone to credit.
      .send({
        settlementMode: 'SINGLE_PAYER',
        payments: [{ participantId, method: 'CASH' }],
      })
      .expect(201);
    const paymentId: string = submit.body.payments[0].id;
    await api()
      .post(`/payments/${paymentId}/cash`)
      .set('x-staff-id', fx.staff.server.id)
      .expect(201);
    return { paymentId, phone };
  }

  it('resolves as store credit with a credit note and three audit rows', async () => {
    const { paymentId, phone } = await firedPayment();
    const mgr = fx.staff.manager.id;

    const req = await api()
      .post('/refunds')
      .set('x-staff-id', mgr)
      .send({ paymentId, reasonCode: 'QUALITY' })
      .expect(201);
    const refundId: string = req.body.id;
    expect(req.body.status).toBe('REQUESTED');
    expect(Number(req.body.amount)).toBe(350);

    await api()
      .post(`/refunds/${refundId}/approve`)
      .set('x-staff-id', mgr)
      .expect(201);
    const resolved = await api()
      .post(`/refunds/${refundId}/resolve`)
      .set('x-staff-id', mgr)
      .send({ mode: 'CREDIT' })
      .expect(201);
    expect(resolved.body.status).toBe('RESOLVED_CREDIT');

    // Credit note issued (PENDING until eTIMS is configured).
    const creditNotes = await prisma.etimsInvoice.findMany({
      where: { paymentId, docType: 'CREDIT_NOTE' },
    });
    expect(creditNotes).toHaveLength(1);
    expect(creditNotes[0].status).toBe('PENDING');

    // Store credit issued to the payer's phone.
    const credit = await prisma.storeCredit.findFirstOrThrow({
      where: { sourceRefundId: refundId },
    });
    expect(credit.phone).toBe(phone);
    expect(Number(credit.balance)).toBe(350);

    // Audit trail: request + approve + resolve.
    const actions = await prisma.auditLog.findMany({
      where: { entityId: refundId },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      'REFUND_REQUEST',
      'REFUND_APPROVE',
      'REFUND_RESOLVE',
    ]);
  });
});
