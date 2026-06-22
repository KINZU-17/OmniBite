import { MpesaService } from './mpesa.service';

/**
 * Idempotency is the non-negotiable for the M-Pesa callback: a replayed callback
 * must never double-confirm. These tests drive handleCallback with a mocked
 * Prisma + settlement to assert the guard.
 */
describe('MpesaService.handleCallback', () => {
  const successBody = (checkoutId: string) => ({
    Body: {
      stkCallback: {
        CheckoutRequestID: checkoutId,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 850 },
            { Name: 'MpesaReceiptNumber', Value: 'ABC123XYZ' },
            { Name: 'PhoneNumber', Value: 254700000000 },
          ],
        },
      },
    },
  });

  function build(txnRow: any) {
    const prisma = {
      mpesaTransaction: {
        findUnique: jest.fn().mockResolvedValue(txnRow),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const settlement = {
      confirmPayment: jest.fn().mockResolvedValue({ fired: true }),
      failPayment: jest.fn().mockResolvedValue(undefined),
    };
    const service = new MpesaService(
      prisma as any,
      {} as any,
      settlement as any,
      { get: () => 120 } as any,
    );
    return { service, prisma, settlement };
  }

  it('confirms a fresh successful callback exactly once', async () => {
    const { service, prisma, settlement } = build({
      paymentId: 'pay-1',
      checkoutRequestId: 'co-1',
      mpesaReceipt: null,
    });
    await service.handleCallback(successBody('co-1'));
    expect(prisma.mpesaTransaction.update).toHaveBeenCalledTimes(1);
    expect(settlement.confirmPayment).toHaveBeenCalledWith('pay-1');
  });

  it('ignores a replayed callback once the receipt is recorded', async () => {
    const { service, prisma, settlement } = build({
      paymentId: 'pay-1',
      checkoutRequestId: 'co-1',
      mpesaReceipt: 'ABC123XYZ', // already processed
    });
    await service.handleCallback(successBody('co-1'));
    expect(prisma.mpesaTransaction.update).not.toHaveBeenCalled();
    expect(settlement.confirmPayment).not.toHaveBeenCalled();
  });

  it('fails the payment on a non-zero result code', async () => {
    const { service, settlement } = build({
      paymentId: 'pay-2',
      checkoutRequestId: 'co-2',
      mpesaReceipt: null,
    });
    await service.handleCallback({
      Body: {
        stkCallback: {
          CheckoutRequestID: 'co-2',
          ResultCode: 1032,
          ResultDesc: 'Cancelled by user',
        },
      },
    });
    expect(settlement.failPayment).toHaveBeenCalledWith(
      'pay-2',
      'Cancelled by user',
    );
  });

  it('ignores a callback for an unknown checkout id', async () => {
    const { service, settlement } = build(null);
    await service.handleCallback(successBody('nope'));
    expect(settlement.confirmPayment).not.toHaveBeenCalled();
    expect(settlement.failPayment).not.toHaveBeenCalled();
  });
});
