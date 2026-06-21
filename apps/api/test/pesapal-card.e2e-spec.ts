import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { bootstrap, resetDb, seedFixtures, type Fixtures } from './helpers';
import { PesapalClient } from '../src/pesapal/pesapal.client';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * Card via Pesapal: submitting a card payment opens a hosted-checkout order
 * (payment PENDING, diner redirected), and the IPN drives it through the same
 * PAID gate — once, idempotently. The Pesapal HTTP client is mocked so the test
 * never leaves the process.
 */
describe('Card payment via Pesapal', () => {
  let app!: INestApplication;
  let prisma!: PrismaService;
  let fx!: Fixtures;

  // Fake Pesapal client: order submit returns a fixed tracking id + redirect,
  // and the status query reports COMPLETED (status_code 1).
  const mockPesapal: Partial<PesapalClient> = {
    configured: true,
    submitOrder: jest.fn().mockResolvedValue({
      orderTrackingId: 'track-123',
      merchantReference: 'ref-123',
      redirectUrl: 'https://pesapal.test/checkout/track-123',
    }),
    getStatus: jest.fn().mockResolvedValue({ statusCode: 1, description: 'Completed' }),
  };

  beforeAll(async () => {
    ({ app, prisma } = await bootstrap((b) =>
      b.overrideProvider(PesapalClient).useValue(mockPesapal),
    ));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(prisma);
    fx = await seedFixtures(prisma);
  });

  const api = () => request(app.getHttpServer());

  it('opens a checkout, then fires once on the IPN and ignores the replay', async () => {
    const scan = await api()
      .post('/sessions/scan')
      .send({ qrToken: fx.table.qrToken, displayName: 'Card', phone: '254700000777' })
      .expect(201);
    const sessionId: string = scan.body.sessionId;
    const participantId: string = scan.body.participant.id;

    const round = await api().post(`/sessions/${sessionId}/round`).expect(201);
    const roundId: string = round.body.id;
    await api()
      .post(`/rounds/${roundId}/items`)
      .send({ menuItemId: fx.items.fries.id, participantId, quantity: 1 })
      .expect(201);

    // Submit as CARD → Pesapal order opened, redirect returned, nothing fired yet.
    const submit = await api()
      .post(`/rounds/${roundId}/submit`)
      .send({ settlementMode: 'SINGLE_PAYER', payments: [{ participantId, method: 'CARD' }] })
      .expect(201);
    const payment = submit.body.payments[0];
    expect(submit.body.cardRedirects).toEqual([
      { paymentId: payment.id, redirectUrl: 'https://pesapal.test/checkout/track-123' },
    ]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'PENDING',
    );
    expect(await prisma.kitchenTicket.count({ where: { roundId } })).toBe(0); // not fired

    // IPN → confirm + fire.
    await api()
      .get('/pesapal/ipn')
      .query({ OrderTrackingId: 'track-123', OrderMerchantReference: payment.id, OrderNotificationType: 'IPNCHANGE' })
      .expect(200);

    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'CONFIRMED',
    );
    expect((await prisma.round.findUniqueOrThrow({ where: { id: roundId } })).status).toBe('FIRED');
    expect(await prisma.kitchenTicket.count({ where: { roundId } })).toBe(1);
    expect(
      await prisma.etimsInvoice.count({ where: { paymentId: payment.id, docType: 'INVOICE' } }),
    ).toBe(1);

    // Replayed IPN → no double fire / invoice.
    await api()
      .get('/pesapal/ipn')
      .query({ OrderTrackingId: 'track-123', OrderMerchantReference: payment.id })
      .expect(200);
    expect(await prisma.kitchenTicket.count({ where: { roundId } })).toBe(1);
    expect(
      await prisma.etimsInvoice.count({ where: { paymentId: payment.id, docType: 'INVOICE' } }),
    ).toBe(1);
  });
});
