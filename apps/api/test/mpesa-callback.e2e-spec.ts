import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { bootstrap, resetDb, seedFixtures, type Fixtures } from './helpers';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * M-Pesa callback idempotency against the live DB: a Daraja STK callback fires
 * the round exactly once, and a replayed callback (Safaricom retries) never
 * double-confirms, double-fires, or double-invoices. The STK push needs creds,
 * so the PENDING payment + transaction are staged directly, then /mpesa/callback
 * is driven over HTTP exactly as Daraja would.
 */
describe('M-Pesa callback idempotency', () => {
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

  const callbackBody = (checkoutId: string, receipt: string) => ({
    Body: {
      stkCallback: {
        CheckoutRequestID: checkoutId,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 350 },
            { Name: 'MpesaReceiptNumber', Value: receipt },
            { Name: 'PhoneNumber', Value: 254700000555 },
          ],
        },
      },
    },
  });

  it('fires once and ignores the replay', async () => {
    // Build a real round with one item via the API.
    const scan = await api()
      .post('/sessions/scan')
      .send({ qrToken: fx.table.qrToken, displayName: 'Mia', phone: '254700000555' })
      .expect(201);
    const sessionId: string = scan.body.sessionId;
    const participantId: string = scan.body.participant.id;
    const round = await api().post(`/sessions/${sessionId}/round`).expect(201);
    const roundId: string = round.body.id;
    await api()
      .post(`/rounds/${roundId}/items`)
      .send({ menuItemId: fx.items.fries.id, participantId, quantity: 1 })
      .expect(201);

    // Stage the PENDING M-Pesa payment + STK transaction (what initiate() would write).
    const checkoutId = 'co-e2e-1';
    const payment = await prisma.payment.create({
      data: { roundId, participantId, method: 'MPESA', amount: 350, status: 'PENDING' },
    });
    await prisma.mpesaTransaction.create({
      data: {
        paymentId: payment.id,
        checkoutRequestId: checkoutId,
        merchantRequestId: 'mr-e2e-1',
        phone: '254700000555',
        amount: 350,
      },
    });
    await prisma.round.update({
      where: { id: roundId },
      data: { status: 'AWAITING_PAYMENT', settlementMode: 'SINGLE_PAYER' },
    });

    // First callback → confirms + fires.
    await api()
      .post('/mpesa/callback')
      .send(callbackBody(checkoutId, 'RCPT123'))
      .expect(200);

    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'CONFIRMED',
    );
    expect((await prisma.round.findUniqueOrThrow({ where: { id: roundId } })).status).toBe('FIRED');
    expect(await prisma.kitchenTicket.count({ where: { roundId } })).toBe(1);
    expect(
      await prisma.etimsInvoice.count({ where: { paymentId: payment.id, docType: 'INVOICE' } }),
    ).toBe(1);
    expect(
      (await prisma.mpesaTransaction.findUniqueOrThrow({ where: { checkoutRequestId: checkoutId } }))
        .mpesaReceipt,
    ).toBe('RCPT123');

    // Replayed callback → no double anything.
    await api()
      .post('/mpesa/callback')
      .send(callbackBody(checkoutId, 'RCPT123'))
      .expect(200);

    expect(await prisma.kitchenTicket.count({ where: { roundId } })).toBe(1);
    expect(
      await prisma.etimsInvoice.count({ where: { paymentId: payment.id, docType: 'INVOICE' } }),
    ).toBe(1);
  });
});
