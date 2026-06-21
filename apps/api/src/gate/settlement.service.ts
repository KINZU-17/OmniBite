import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  EtimsDocType,
  EtimsStatus,
  Prisma,
  RoundItemStatus,
  RoundStatus,
  SettlementMode,
  TableFloorState,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Db } from '../common/db';
import { resolveStation } from '../common/station';
import { round2, sum, taxFromGross } from '../common/money';
import { isRoundCovered } from './coverage';
import { InternalEvents } from '../realtime/events';
import type { RoundPaidEvent } from '../realtime/events';

const TERMINAL_OR_FIRED: RoundStatus[] = [
  RoundStatus.PAID,
  RoundStatus.FIRED,
  RoundStatus.SERVED,
  RoundStatus.CANCELLED,
];

/**
 * The gate that protects the one rule: no kitchen ticket for an unpaid round.
 *
 * confirmPayment is idempotent (safe to call from a replayed M-Pesa callback or
 * a status query). When confirmation makes a round fully covered, fireRound runs
 * inside the same transaction and does the three things the spec requires "at
 * once": create the kitchen ticket, queue one eTIMS invoice per confirmed
 * payment, and flip the table to PAID. eTIMS transmission is deferred to a
 * worker via the post-commit `round.paid` event, so KRA can never block firing.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** Idempotent confirm. Returns whether the round fired as a result. */
  async confirmPayment(paymentId: string): Promise<{ fired: boolean }> {
    const event = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException('payment not found');
      if (payment.status === 'CONFIRMED') return null; // already done

      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
      return this.recompute(tx, payment.roundId);
    });

    if (event) {
      this.events.emit(InternalEvents.ROUND_PAID, event);
      return { fired: true };
    }
    return { fired: false };
  }

  async failPayment(paymentId: string, resultDesc?: string): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { id: paymentId, status: { notIn: ['CONFIRMED', 'FAILED'] } },
      data: { status: 'FAILED' },
    });
    if (resultDesc)
      this.logger.debug(`payment ${paymentId} failed: ${resultDesc}`);
  }

  /**
   * Split-mode payment window expiry: drop the items of any participant who never
   * paid, then fire the remainder. If nothing payable remains, cancel the round.
   */
  async dropUnpaidAndSettle(
    roundId: string,
  ): Promise<{ fired: boolean; cancelled: boolean }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const round = await tx.round.findUnique({
        where: { id: roundId },
        include: { items: true, payments: true },
      });
      if (!round || TERMINAL_OR_FIRED.includes(round.status)) {
        return { event: null, cancelled: false };
      }

      const confirmedParticipantIds = new Set(
        round.payments
          .filter((p) => p.status === 'CONFIRMED')
          .map((p) => p.participantId),
      );
      const activeItems = round.items.filter(
        (i) => i.status === RoundItemStatus.ACTIVE,
      );
      const unpaid = activeItems.filter(
        (i) => !confirmedParticipantIds.has(i.participantId),
      );

      if (unpaid.length > 0) {
        await tx.roundItem.updateMany({
          where: { id: { in: unpaid.map((i) => i.id) } },
          data: { status: RoundItemStatus.DROPPED_UNPAID },
        });
      }

      const remaining = activeItems.length - unpaid.length;
      if (remaining === 0) {
        await tx.round.update({
          where: { id: roundId },
          data: { status: RoundStatus.CANCELLED },
        });
        return { event: null, cancelled: true };
      }
      const event = await this.recompute(tx, roundId);
      return { event, cancelled: false };
    });

    if (result.event) {
      this.events.emit(InternalEvents.ROUND_PAID, result.event);
      return { fired: true, cancelled: false };
    }
    return { fired: false, cancelled: result.cancelled };
  }

  /**
   * Re-evaluate a round after a payment changes. Fires if covered; otherwise
   * marks PARTIALLY_PAID when at least one portion is in.
   */
  private async recompute(
    tx: Db,
    roundId: string,
  ): Promise<RoundPaidEvent | null> {
    const round = await tx.round.findUnique({
      where: { id: roundId },
      include: {
        items: {
          where: { status: RoundItemStatus.ACTIVE },
          include: { menuItem: true },
        },
        payments: true,
        session: true,
      },
    });
    if (!round || TERMINAL_OR_FIRED.includes(round.status)) return null;

    const confirmed = round.payments.filter((p) => p.status === 'CONFIRMED');
    if (confirmed.length === 0) return null;

    const covered = isRoundCovered(
      round.settlementMode,
      round.items,
      confirmed,
    );
    if (!covered) {
      await tx.round.update({
        where: { id: roundId },
        data: { status: RoundStatus.PARTIALLY_PAID },
      });
      return null;
    }
    return this.fireRound(tx, round, confirmed);
  }

  /** Atomic: ticket + per-payment eTIMS invoices + floor flip. Idempotent. */
  private async fireRound(
    tx: Db,
    round: Prisma.RoundGetPayload<{
      include: {
        items: { include: { menuItem: true } };
        payments: true;
        session: true;
      };
    }>,
    confirmed: Prisma.PaymentGetPayload<object>[],
  ): Promise<RoundPaidEvent> {
    const locationId = round.session.locationId;
    const tableId = round.session.tableId;
    const location = await tx.location.findUniqueOrThrow({
      where: { id: locationId },
    });

    // 1. Kitchen ticket (UNIQUE round_id guarantees one ticket per round).
    const ticket = await tx.kitchenTicket.create({
      data: {
        roundId: round.id,
        locationId,
        status: TicketStatus.QUEUED,
        lines: {
          create: round.items.map((item) => ({
            roundItemId: item.id,
            station: resolveStation(item.menuItem.category),
            status: TicketStatus.QUEUED,
          })),
        },
      },
    });

    // 2. One eTIMS invoice per confirmed payment (PENDING; transmitted async).
    const invoiceIds: string[] = [];
    for (const payment of confirmed) {
      const lineItems =
        round.settlementMode === SettlementMode.SPLIT
          ? round.items.filter((i) => i.participantId === payment.participantId)
          : round.items;
      if (lineItems.length === 0) continue;

      const taxAmount = sum(
        lineItems.map((i) => taxFromGross(i.lineTotal, i.menuItem.taxRate)),
      );
      const totalAmount = sum(lineItems.map((i) => i.lineTotal));

      const invoice = await tx.etimsInvoice.create({
        data: {
          paymentId: payment.id,
          locationId,
          docType: EtimsDocType.INVOICE,
          status: EtimsStatus.PENDING,
          sellerPin: location.kraPin,
          totalAmount,
          taxAmount,
          lines: {
            create: lineItems.map((i) => ({
              description: i.menuItem.name,
              itemCode: i.menuItem.itemCode,
              quantity: i.quantity,
              unitPrice: round2(
                new Prisma.Decimal(i.lineTotal).div(i.quantity),
              ),
              taxRate: i.menuItem.taxRate,
              taxAmount: taxFromGross(i.lineTotal, i.menuItem.taxRate),
            })),
          },
        },
      });
      invoiceIds.push(invoice.id);
    }

    // 3. Round -> PAID then FIRED (ticket exists); table -> PAID.
    await tx.round.update({
      where: { id: round.id },
      data: { status: RoundStatus.FIRED, paidAt: new Date() },
    });
    await tx.restaurantTable.update({
      where: { id: tableId },
      data: { floorState: TableFloorState.PAID },
    });

    this.logger.log(`round ${round.id} PAID -> fired ticket ${ticket.id}`);
    return {
      roundId: round.id,
      locationId,
      ticketId: ticket.id,
      invoiceIds,
      tableId,
    };
  }
}
