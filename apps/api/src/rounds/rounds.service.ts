import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RoundStatus, SettlementMode, TableFloorState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { SettlementService } from '../gate/settlement.service';
import { RealtimeService } from '../realtime/realtime.service';
import { computeLineTotal } from '../common/money';
import { SubmitRoundDto } from '../payments/dto';
import { AddItemDto } from './dto';

@Injectable()
export class RoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly settlement: SettlementService,
    private readonly realtime: RealtimeService,
  ) {}

  /** The open cart for a session. At most one BUILDING round at a time. */
  async getOrCreateBuildingRound(sessionId: string) {
    const session = await this.prisma.tableSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('session not found');
    if (session.status !== 'ACTIVE') throw new BadRequestException('session is not active');

    const existing = await this.prisma.round.findFirst({
      where: { sessionId, status: RoundStatus.BUILDING },
    });
    if (existing) return existing;
    return this.prisma.round.create({ data: { sessionId } });
  }

  /**
   * Add an item to a BUILDING round, tagged to the diner who ordered it. The 86
   * check runs here, so an out-of-stock item can never enter the round
   * (invariant 7). Price and modifier deltas are snapshotted at order time.
   */
  async addItem(roundId: string, dto: AddItemDto) {
    const round = await this.requireBuilding(roundId);

    const menuItem = await this.prisma.menuItem.findUnique({
      where: { id: dto.menuItemId },
    });
    if (!menuItem) throw new NotFoundException('menu item not found');
    if (menuItem.is86) throw new BadRequestException('item is 86ed (out of stock)');

    const participant = await this.prisma.sessionParticipant.findFirst({
      where: { id: dto.participantId, sessionId: round.sessionId },
    });
    if (!participant) throw new BadRequestException('participant not in this session');

    const modifiers = dto.modifierIds?.length
      ? await this.prisma.modifier.findMany({ where: { id: { in: dto.modifierIds } } })
      : [];
    if (modifiers.length !== (dto.modifierIds?.length ?? 0)) {
      throw new BadRequestException('unknown modifier');
    }

    const quantity = dto.quantity ?? 1;
    const deltas = modifiers.map((m) => m.priceDelta);
    const unitPrice = menuItem.basePrice;
    const lineTotal = computeLineTotal(unitPrice, deltas, quantity);

    return this.prisma.roundItem.create({
      data: {
        roundId,
        menuItemId: menuItem.id,
        participantId: participant.id,
        quantity,
        unitPrice,
        lineTotal,
        notes: dto.notes,
        modifiers: {
          create: modifiers.map((m) => ({ modifierId: m.id, priceDelta: m.priceDelta })),
        },
      },
      include: { modifiers: true, menuItem: true },
    });
  }

  async removeItem(roundId: string, itemId: string) {
    await this.requireBuilding(roundId);
    const item = await this.prisma.roundItem.findFirst({ where: { id: itemId, roundId } });
    if (!item) throw new NotFoundException('item not in round');
    await this.prisma.roundItemModifier.deleteMany({ where: { roundItemId: itemId } });
    await this.prisma.roundItem.delete({ where: { id: itemId } });
    return { removed: itemId };
  }

  /**
   * BUILDING -> SUBMITTED (items freeze, settlement mode chosen), then hand to
   * payments which creates the payment requests and moves to AWAITING_PAYMENT.
   * No kitchen ticket exists yet — that only happens at the PAID gate.
   */
  async submit(roundId: string, dto: SubmitRoundDto) {
    const round = await this.requireBuilding(roundId);
    const itemCount = await this.prisma.roundItem.count({ where: { roundId } });
    if (itemCount === 0) throw new BadRequestException('cannot submit an empty round');

    const session = await this.prisma.tableSession.findUniqueOrThrow({
      where: { id: round.sessionId },
    });

    await this.prisma.$transaction([
      this.prisma.round.update({
        where: { id: roundId },
        data: { status: RoundStatus.SUBMITTED, settlementMode: dto.settlementMode, submittedAt: new Date() },
      }),
      this.prisma.restaurantTable.update({
        where: { id: session.tableId },
        data: { floorState: TableFloorState.ORDERED },
      }),
    ]);
    this.realtime.emitTableState(session.locationId, session.tableId, TableFloorState.ORDERED);

    const payments = await this.payments.createForRound(roundId, dto);
    return { roundId, status: RoundStatus.AWAITING_PAYMENT, payments };
  }

  async cancel(roundId: string) {
    const round = await this.prisma.round.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundException('round not found');
    const blocked: RoundStatus[] = [RoundStatus.FIRED, RoundStatus.SERVED, RoundStatus.PAID];
    if (blocked.includes(round.status)) {
      throw new BadRequestException('cannot cancel a paid/fired round');
    }
    return this.prisma.round.update({
      where: { id: roundId },
      data: { status: RoundStatus.CANCELLED },
    });
  }

  /**
   * Split payment window expiry: any round still awaiting full payment past its
   * window has unpaid portions dropped and the remainder fired (or cancelled if
   * nothing remains). The table is never held hostage by one non-payer.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async reapExpiredWindows(): Promise<void> {
    const due = await this.prisma.round.findMany({
      where: {
        status: { in: [RoundStatus.AWAITING_PAYMENT, RoundStatus.PARTIALLY_PAID] },
        settlementMode: SettlementMode.SPLIT,
        paymentWindowExpiresAt: { lt: new Date() },
      },
      select: { id: true },
      take: 50,
    });
    for (const r of due) {
      await this.settlement.dropUnpaidAndSettle(r.id);
    }
  }

  private async requireBuilding(roundId: string) {
    const round = await this.prisma.round.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundException('round not found');
    if (round.status !== RoundStatus.BUILDING) {
      throw new BadRequestException(`round is ${round.status}, items are frozen`);
    }
    return round;
  }
}
