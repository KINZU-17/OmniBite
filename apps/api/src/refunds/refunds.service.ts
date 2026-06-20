import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RefundStatus,
  RoundItemStatus,
  Staff,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EtimsService } from '../etims/etims.service';
import { MpesaClient } from '../mpesa/mpesa.client';
import { money } from '../common/money';
import { RequestRefundDto, ResolveRefundDto } from './dto';

/**
 * Refunds: the other half of pay-before-fire, since money is taken first. Store
 * credit is the default remedy (instant); a true M-Pesa reversal is the slow
 * fallback. Every refund produces an eTIMS credit note and an audit entry
 * (invariant 5).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly etims: EtimsService,
    private readonly mpesa: MpesaClient,
  ) {}

  async request(dto: RequestRefundDto, staff: Staff) {
    const payment = await this.prisma.payment.findUnique({ where: { id: dto.paymentId } });
    if (!payment) throw new NotFoundException('payment not found');
    if (payment.status !== 'CONFIRMED') {
      throw new BadRequestException('can only refund a confirmed payment');
    }

    let amount = dto.amount ? money(dto.amount) : payment.amount;
    if (dto.roundItemId && !dto.amount) {
      const item = await this.prisma.roundItem.findUnique({ where: { id: dto.roundItemId } });
      if (!item) throw new NotFoundException('round item not found');
      amount = item.lineTotal;
    }

    const refund = await this.prisma.refund.create({
      data: {
        paymentId: dto.paymentId,
        roundItemId: dto.roundItemId,
        amount,
        reasonCode: dto.reasonCode,
        requestedBy: staff.id,
      },
    });
    await this.audit.log({
      locationId: await this.locationOf(payment.roundId),
      staffId: staff.id,
      action: 'REFUND_REQUEST',
      entityType: 'refund',
      entityId: refund.id,
      after: { amount: amount.toString(), reasonCode: dto.reasonCode },
    });
    return refund;
  }

  /** Manager approval, required above a threshold (and good practice always). */
  async approve(refundId: string, staff: Staff) {
    const refund = await this.requireRefund(refundId);
    if (refund.status !== RefundStatus.REQUESTED) {
      throw new BadRequestException(`refund is ${refund.status}`);
    }
    const updated = await this.prisma.refund.update({
      where: { id: refundId },
      data: { status: RefundStatus.APPROVED, approvedBy: staff.id },
    });
    await this.audit.log({
      locationId: await this.locationOf(refund.paymentId, true),
      staffId: staff.id,
      action: 'REFUND_APPROVE',
      entityType: 'refund',
      entityId: refundId,
    });
    return updated;
  }

  /** Resolve an approved refund as store credit (default) or M-Pesa reversal. */
  async resolve(refundId: string, dto: ResolveRefundDto, staff: Staff) {
    const refund = await this.requireRefund(refundId);
    if (refund.status !== RefundStatus.APPROVED) {
      throw new BadRequestException('refund must be APPROVED before resolving');
    }

    const ctx = await this.buildCreditContext(refund.paymentId, refund.roundItemId);

    const { creditNoteId } = await this.prisma.$transaction(async (tx) => {
      const creditNoteId = await this.etims.createCreditNote(tx, {
        paymentId: refund.paymentId,
        locationId: ctx.locationId,
        sellerPin: ctx.sellerPin,
        buyerPin: ctx.buyerPin,
        lines: ctx.lines,
      });

      if (dto.mode === 'CREDIT') {
        if (ctx.phone) {
          await tx.storeCredit.create({
            data: {
              phone: ctx.phone,
              sourceRefundId: refund.id,
              amount: refund.amount,
              balance: refund.amount,
            },
          });
        }
        await tx.refund.update({
          where: { id: refundId },
          data: { status: RefundStatus.RESOLVED_CREDIT, creditNoteId, resolvedAt: new Date() },
        });
      } else {
        await tx.refund.update({
          where: { id: refundId },
          data: { status: RefundStatus.REVERSAL_PENDING, creditNoteId },
        });
      }

      if (refund.roundItemId) {
        await tx.roundItem.update({
          where: { id: refund.roundItemId },
          data: { status: RoundItemStatus.REFUNDED },
        });
      }
      return { creditNoteId };
    });

    await this.audit.log({
      locationId: ctx.locationId,
      staffId: staff.id,
      action: 'REFUND_RESOLVE',
      entityType: 'refund',
      entityId: refundId,
      after: { mode: dto.mode, amount: refund.amount.toString(), creditNoteId },
    });

    // Transmit the credit note (async; never blocks) and fire the reversal if asked.
    await this.etims.transmit(creditNoteId).catch((e) =>
      this.logger.warn(`credit note ${creditNoteId} transmit deferred: ${String(e)}`),
    );
    if (dto.mode === 'REVERSAL') await this.initiateReversal(refund.paymentId, refund.amount);

    return this.prisma.refund.findUnique({ where: { id: refundId } });
  }

  /**
   * Spec edge: an item 86'd after payment but before service is auto-refunded as
   * store credit. Attributed to a manager/admin at the location as the actor.
   */
  async autoRefundItem(roundItemId: string, reasonCode = 'ITEM_86_AFTER_PAID'): Promise<void> {
    const item = await this.prisma.roundItem.findUnique({
      where: { id: roundItemId },
      include: { round: { include: { payments: true, session: true } } },
    });
    if (!item || item.status !== RoundItemStatus.ACTIVE) return;

    const payment =
      item.round.payments.find((p) => p.status === 'CONFIRMED' && p.participantId === item.participantId) ??
      item.round.payments.find((p) => p.status === 'CONFIRMED');
    if (!payment) return;

    const actor = await this.prisma.staff.findFirst({
      where: { locationId: item.round.session.locationId, role: { in: ['MANAGER', 'ADMIN'] }, active: true },
    });
    if (!actor) {
      this.logger.warn(`no manager/admin to attribute auto-refund for item ${roundItemId}`);
      return;
    }

    const refund = await this.request(
      { paymentId: payment.id, roundItemId, reasonCode },
      actor,
    );
    await this.approve(refund.id, actor);
    await this.resolve(refund.id, { mode: 'CREDIT' }, actor);
  }

  // --- helpers ---------------------------------------------------------------

  private async initiateReversal(paymentId: string, amount: Prisma.Decimal): Promise<void> {
    const txn = await this.prisma.mpesaTransaction.findUnique({ where: { paymentId } });
    if (!txn?.mpesaReceipt) {
      this.logger.warn(`no M-Pesa receipt for payment ${paymentId}; reversal not sent`);
      return;
    }
    try {
      await this.mpesa.reversal({
        transactionId: txn.mpesaReceipt,
        amount: Math.round(Number(amount)),
        receiver: txn.phone,
      });
    } catch (err) {
      this.logger.error(`reversal request failed for ${paymentId}: ${String(err)}`);
    }
  }

  private async buildCreditContext(paymentId: string, roundItemId: string | null) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        round: {
          include: {
            session: { include: { location: true } },
            items: { include: { menuItem: true } },
          },
        },
      },
    });
    const original = await this.prisma.etimsInvoice.findFirst({
      where: { paymentId, docType: 'INVOICE' },
    });

    const items = roundItemId
      ? payment.round.items.filter((i) => i.id === roundItemId)
      : payment.round.settlementMode === 'SPLIT'
        ? payment.round.items.filter((i) => i.participantId === payment.participantId)
        : payment.round.items;

    const participant = payment.participantId
      ? await this.prisma.sessionParticipant.findUnique({ where: { id: payment.participantId } })
      : null;

    return {
      locationId: original?.locationId ?? payment.round.session.locationId,
      sellerPin: original?.sellerPin ?? payment.round.session.location.kraPin,
      buyerPin: original?.buyerPin ?? null,
      phone: participant?.phone ?? null,
      lines: items.map((i) => ({
        description: i.menuItem.name,
        itemCode: i.menuItem.itemCode,
        quantity: i.quantity,
        unitPrice: new Prisma.Decimal(i.lineTotal).div(i.quantity),
        taxRate: i.menuItem.taxRate,
      })),
    };
  }

  private async requireRefund(id: string) {
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException('refund not found');
    return refund;
  }

  private async locationOf(roundId: string, isPaymentId = false): Promise<string> {
    if (isPaymentId) {
      const p = await this.prisma.payment.findUniqueOrThrow({
        where: { id: roundId },
        include: { round: { include: { session: true } } },
      });
      return p.round.session.locationId;
    }
    const round = await this.prisma.round.findUniqueOrThrow({
      where: { id: roundId },
      include: { session: true },
    });
    return round.session.locationId;
  }
}
