import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Payment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementService } from '../gate/settlement.service';
import { PesapalClient } from './pesapal.client';

/**
 * Card payments via Pesapal (hosted checkout). The flow mirrors M-Pesa: a card
 * payment is INITIATED at submit, an order is created and the payment moves to
 * PENDING while the diner pays on Pesapal's page, and nothing fires until the
 * IPN (or the status reaper) confirms. confirmPayment runs through the same PAID
 * gate, so the one rule still holds: no kitchen ticket for an unpaid round.
 */
@Injectable()
export class PesapalService {
  private readonly logger = new Logger(PesapalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PesapalClient,
    private readonly settlement: SettlementService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create a hosted-checkout order for a card payment. On success the payment
   * moves INITIATED -> PENDING and the caller redirects the diner to the URL.
   */
  async initiate(
    payment: Payment,
    opts: { email?: string; phone?: string } = {},
  ): Promise<{ redirectUrl: string | null }> {
    if (!this.client.configured) {
      await this.settlement.failPayment(payment.id, 'Pesapal not configured');
      return { redirectUrl: null };
    }

    let res;
    try {
      res = await this.client.submitOrder({
        amount: Number(payment.amount),
        currency: this.config.get<string>('PESAPAL_CURRENCY', 'KES'),
        reference: payment.id,
        description: 'OmniBite order',
        callbackUrl: this.config.get<string>('PESAPAL_CALLBACK_URL', ''),
        notificationId: this.config.get<string>('PESAPAL_IPN_ID', ''),
        email: opts.email,
        phone: opts.phone,
      });
    } catch (err) {
      this.logger.error(
        `Pesapal submit failed for payment ${payment.id}: ${String(err)}`,
      );
      await this.settlement.failPayment(
        payment.id,
        'Pesapal order request failed',
      );
      return { redirectUrl: null };
    }

    if (!res.orderTrackingId || !res.redirectUrl) {
      await this.settlement.failPayment(
        payment.id,
        'Pesapal returned no redirect',
      );
      return { redirectUrl: null };
    }

    await this.prisma.$transaction([
      this.prisma.cardTransaction.create({
        data: {
          paymentId: payment.id,
          gatewayRef: res.orderTrackingId,
          redirectUrl: res.redirectUrl,
        },
      }),
      this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'PENDING' },
      }),
    ]);
    return { redirectUrl: res.redirectUrl };
  }

  /**
   * Pesapal IPN — the source of truth for a card payment. Idempotent: a payment
   * already resolved is a no-op, and confirmPayment never double-fires, so a
   * replayed notification can't double-charge the kitchen.
   */
  async handleIpn(orderTrackingId: string): Promise<void> {
    const txn = await this.prisma.cardTransaction.findUnique({
      where: { gatewayRef: orderTrackingId },
    });
    if (!txn) {
      this.logger.warn(`IPN for unknown order ${orderTrackingId}`);
      return;
    }
    const payment = await this.prisma.payment.findUnique({
      where: { id: txn.paymentId },
    });
    if (
      !payment ||
      payment.status === 'CONFIRMED' ||
      payment.status === 'FAILED'
    ) {
      return; // already resolved
    }
    await this.resolve(orderTrackingId, txn.paymentId);
  }

  private async resolve(
    orderTrackingId: string,
    paymentId: string,
  ): Promise<void> {
    let res;
    try {
      res = await this.client.getStatus(orderTrackingId);
    } catch (err) {
      this.logger.warn(
        `status query failed for ${orderTrackingId}: ${String(err)}`,
      );
      return;
    }
    await this.prisma.cardTransaction.update({
      where: { gatewayRef: orderTrackingId },
      data: {
        status: res.description,
        resultDesc: res.description,
        authCode: res.confirmationCode ?? null,
        ipnAt: new Date(),
      },
    });
    if (res.statusCode === 1) {
      await this.settlement.confirmPayment(paymentId);
    } else if (res.statusCode === 2 || res.statusCode === 3) {
      await this.settlement.failPayment(paymentId, res.description);
    }
    // statusCode 0 (invalid/pending): leave PENDING for the reaper.
  }

  /**
   * Backstop: any card payment stuck PENDING past the timeout is actively
   * resolved via a status query, so none ever rests pending forever (invariant 4
   * extended to card).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reapPending(): Promise<void> {
    if (!this.client.configured) return;
    const timeoutSec = this.config.get<number>(
      'PESAPAL_STATUS_TIMEOUT_SECONDS',
      180,
    );
    const cutoff = new Date(Date.now() - timeoutSec * 1000);

    const stale = await this.prisma.payment.findMany({
      where: {
        method: 'CARD',
        status: 'PENDING',
        createdAt: { lt: cutoff },
        cardTransaction: { isNot: null },
      },
      include: { cardTransaction: true },
      take: 50,
    });

    for (const payment of stale) {
      const txn = payment.cardTransaction!;
      await this.prisma.cardTransaction.update({
        where: { id: txn.id },
        data: { statusQueryCount: { increment: 1 } },
      });
      await this.resolve(txn.gatewayRef, payment.id);
    }
  }
}
