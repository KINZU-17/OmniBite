import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EtimsDocType, EtimsStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Db } from '../common/db';
import { round2, sum, taxFromGross } from '../common/money';
import { EtimsClient } from './etims.client';
import { InternalEvents } from '../realtime/events';
import type { RoundPaidEvent } from '../realtime/events';

/**
 * eTIMS invoicing. The critical decoupling: transmission is fully async and never
 * blocks firing the kitchen. Invoices are created PENDING at the PAID gate; this
 * service transmits them on the round.paid event and via a retry worker, so a KRA
 * outage delays the tax record but never delays serving food.
 */
@Injectable()
export class EtimsService {
  private readonly logger = new Logger(EtimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: EtimsClient,
    private readonly config: ConfigService,
  ) {}

  /** Try transmitting straight away when a round fires (best effort). */
  @OnEvent(InternalEvents.ROUND_PAID)
  async onRoundPaid(evt: RoundPaidEvent): Promise<void> {
    for (const invoiceId of evt.invoiceIds) {
      await this.transmit(invoiceId).catch((err) =>
        this.logger.warn(
          `initial eTIMS transmit failed for ${invoiceId}: ${String(err)}`,
        ),
      );
    }
  }

  /** Retry worker: sweep anything not yet transmitted, with a retry ceiling. */
  @Cron(CronExpression.EVERY_MINUTE)
  async retryPending(): Promise<void> {
    if (!this.client.configured) return; // nothing to do until eTIMS is wired up
    const maxRetries = this.config.get<number>('ETIMS_MAX_RETRIES', 20);
    const due = await this.prisma.etimsInvoice.findMany({
      where: {
        status: { in: [EtimsStatus.PENDING, EtimsStatus.FAILED] },
        retryCount: { lt: maxRetries },
      },
      select: { id: true },
      take: 50,
    });
    for (const inv of due) {
      await this.transmit(inv.id).catch(() => undefined);
    }
  }

  /** Transmit one invoice/credit note and persist the KRA fiscal data. */
  async transmit(invoiceId: string): Promise<void> {
    const invoice = await this.prisma.etimsInvoice.findUnique({
      where: { id: invoiceId },
      include: { lines: true },
    });
    if (!invoice) throw new NotFoundException('invoice not found');
    if (invoice.status === EtimsStatus.TRANSMITTED) return;

    // Until eTIMS is wired up, leave the invoice/credit note PENDING rather than
    // marking it FAILED on every sale and refund; the retry worker (which also
    // no-ops while unconfigured) transmits everything once ETIMS_BASE_URL is set.
    // Keeps FAILED meaningful — a real transmission failure, not "not wired up".
    if (!this.client.configured) return;

    let originalInvoiceNo: string | null = null;
    if (invoice.docType === EtimsDocType.CREDIT_NOTE) {
      const original = await this.prisma.etimsInvoice.findFirst({
        where: { paymentId: invoice.paymentId, docType: EtimsDocType.INVOICE },
      });
      originalInvoiceNo = original?.kraInvoiceNo ?? null;
    }

    try {
      const result = await this.client.transmit({
        docType: invoice.docType,
        sellerPin: invoice.sellerPin,
        buyerPin: invoice.buyerPin,
        totalAmount: invoice.totalAmount.toString(),
        taxAmount: invoice.taxAmount.toString(),
        originalInvoiceNo,
        lines: invoice.lines.map((l) => ({
          description: l.description,
          itemCode: l.itemCode,
          quantity: l.quantity,
          unitPrice: l.unitPrice.toString(),
          taxRate: l.taxRate.toString(),
          taxAmount: l.taxAmount.toString(),
        })),
      });
      await this.prisma.etimsInvoice.update({
        where: { id: invoiceId },
        data: {
          status: EtimsStatus.TRANSMITTED,
          kraInvoiceNo: result.invoiceNo,
          kraQrData: result.qrData,
          transmittedAt: new Date(),
          lastError: null,
        },
      });
      this.logger.log(
        `eTIMS ${invoice.docType} ${invoiceId} transmitted (${result.invoiceNo})`,
      );
    } catch (err) {
      await this.prisma.etimsInvoice.update({
        where: { id: invoiceId },
        data: {
          status: EtimsStatus.FAILED,
          retryCount: { increment: 1 },
          lastError: String(err).slice(0, 500),
        },
      });
      throw err;
    }
  }

  /**
   * Issue an eTIMS credit note for a refund, through the same solution that issued
   * the original invoice. Returns the credit-note invoice id (linked from refunds).
   * Runs inside the caller's transaction so the refund and credit note are atomic.
   */
  async createCreditNote(
    db: Db,
    params: {
      paymentId: string;
      locationId: string;
      sellerPin: string;
      buyerPin?: string | null;
      lines: Array<{
        description: string;
        itemCode: string;
        quantity: number;
        unitPrice: Prisma.Decimal.Value;
        taxRate: Prisma.Decimal.Value;
      }>;
    },
  ): Promise<string> {
    const taxAmount = sum(
      params.lines.map((l) =>
        taxFromGross(
          new Prisma.Decimal(l.unitPrice).mul(l.quantity),
          l.taxRate,
        ),
      ),
    );
    const totalAmount = sum(
      params.lines.map((l) => new Prisma.Decimal(l.unitPrice).mul(l.quantity)),
    );

    const creditNote = await db.etimsInvoice.create({
      data: {
        paymentId: params.paymentId,
        locationId: params.locationId,
        docType: EtimsDocType.CREDIT_NOTE,
        status: EtimsStatus.PENDING,
        sellerPin: params.sellerPin,
        buyerPin: params.buyerPin ?? null,
        totalAmount,
        taxAmount,
        lines: {
          create: params.lines.map((l) => ({
            description: l.description,
            itemCode: l.itemCode,
            quantity: l.quantity,
            unitPrice: round2(l.unitPrice),
            taxRate: new Prisma.Decimal(l.taxRate),
            taxAmount: taxFromGross(
              new Prisma.Decimal(l.unitPrice).mul(l.quantity),
              l.taxRate,
            ),
          })),
        },
      },
    });
    return creditNote.id;
  }
}
