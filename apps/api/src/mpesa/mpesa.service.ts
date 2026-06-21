import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Payment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementService } from '../gate/settlement.service';
import { MpesaClient } from './mpesa.client';

interface MetaItem {
  Name: string;
  Value?: string | number;
}

@Injectable()
export class MpesaService {
  private readonly logger = new Logger(MpesaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: MpesaClient,
    private readonly settlement: SettlementService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Fire the STK push for a payment. On acceptance (ResponseCode 0) the payment
   * moves INITIATED -> PENDING and an mpesa_transactions row records the checkout
   * id. The customer now sees the PIN prompt; nothing fires until the callback.
   */
  async initiate(
    payment: Payment,
    phone: string,
    accountReference: string,
  ): Promise<void> {
    let res;
    try {
      res = await this.client.stkPush({
        amount: Math.round(Number(payment.amount)),
        phone,
        accountReference,
        description: 'OmniBite',
      });
    } catch (err) {
      this.logger.error(
        `STK push failed for payment ${payment.id}: ${String(err)}`,
      );
      await this.settlement.failPayment(payment.id, 'STK push request failed');
      return;
    }

    if (res.ResponseCode !== '0' || !res.CheckoutRequestID) {
      await this.settlement.failPayment(
        payment.id,
        `STK not accepted: ${res.ResponseCode}`,
      );
      return;
    }

    await this.prisma.$transaction([
      this.prisma.mpesaTransaction.create({
        data: {
          paymentId: payment.id,
          checkoutRequestId: res.CheckoutRequestID,
          merchantRequestId: res.MerchantRequestID,
          phone,
          amount: payment.amount,
        },
      }),
      this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'PENDING' },
      }),
    ]);
  }

  /**
   * Daraja callback — the source of truth. Idempotent on the M-Pesa receipt so a
   * replayed callback never double-confirms. Caller must ack with 200 quickly.
   */
  async handleCallback(body: any): Promise<void> {
    const cb = body?.Body?.stkCallback ?? body?.stkCallback ?? body;
    const checkoutRequestId: string | undefined = cb?.CheckoutRequestID;
    if (!checkoutRequestId) {
      this.logger.warn('callback without CheckoutRequestID, ignoring');
      return;
    }

    const txn = await this.prisma.mpesaTransaction.findUnique({
      where: { checkoutRequestId },
    });
    if (!txn) {
      this.logger.warn(`callback for unknown checkout id ${checkoutRequestId}`);
      return;
    }
    if (txn.mpesaReceipt) return; // idempotency: already processed

    const resultCode = Number(cb.ResultCode);
    if (resultCode === 0) {
      const items: MetaItem[] = cb.CallbackMetadata?.Item ?? [];
      const receipt = String(this.meta(items, 'MpesaReceiptNumber') ?? '');
      try {
        await this.prisma.mpesaTransaction.update({
          where: { checkoutRequestId },
          data: {
            mpesaReceipt: receipt || null,
            resultCode,
            resultDesc: cb.ResultDesc,
            callbackAt: new Date(),
          },
        });
      } catch {
        return; // unique receipt clash => duplicate, already handled
      }
      await this.settlement.confirmPayment(txn.paymentId);
    } else {
      await this.prisma.mpesaTransaction.update({
        where: { checkoutRequestId },
        data: { resultCode, resultDesc: cb.ResultDesc, callbackAt: new Date() },
      });
      await this.settlement.failPayment(txn.paymentId, cb.ResultDesc);
    }
  }

  /**
   * Status-query backstop. Any payment that ages past the timeout in PENDING or
   * UNKNOWN is actively resolved, so none ever rests pending forever (invariant 4).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reapPending(): Promise<void> {
    const timeoutSec = this.config.get<number>(
      'MPESA_STATUS_TIMEOUT_SECONDS',
      120,
    );
    const cutoff = new Date(Date.now() - timeoutSec * 1000);

    const stale = await this.prisma.payment.findMany({
      where: {
        method: 'MPESA',
        status: { in: ['PENDING', 'UNKNOWN'] },
        createdAt: { lt: cutoff },
        mpesaTransaction: { isNot: null },
      },
      include: { mpesaTransaction: true },
      take: 50,
    });

    for (const payment of stale) {
      const txn = payment.mpesaTransaction!;
      try {
        await this.prisma.mpesaTransaction.update({
          where: { id: txn.id },
          data: { statusQueryCount: { increment: 1 } },
        });
        const res = await this.client.stkQuery(txn.checkoutRequestId);
        const code = Number(res.ResultCode);
        if (code === 0) {
          await this.settlement.confirmPayment(payment.id);
        } else if (!Number.isNaN(code)) {
          await this.settlement.failPayment(payment.id, res.ResultDesc);
        } else {
          await this.prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'UNKNOWN' },
          });
        }
      } catch (err) {
        this.logger.warn(
          `status query failed for ${payment.id}: ${String(err)}`,
        );
      }
    }
  }

  private meta(items: MetaItem[], name: string): string | number | undefined {
    return items.find((i) => i.Name === name)?.Value;
  }
}
