import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RoundStatus, TableFloorState, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';

@Injectable()
export class KitchenService {
  private readonly logger = new Logger(KitchenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly sessions: SessionsService,
  ) {}

  /** The live board: every unfinished paid ticket for a location. */
  getBoard(locationId: string) {
    return this.prisma.kitchenTicket.findMany({
      where: { locationId, status: { in: ['QUEUED', 'IN_PREP', 'READY'] } },
      include: { lines: { include: { roundItem: { include: { menuItem: true } } } } },
      orderBy: { firedAt: 'asc' },
    });
  }

  /**
   * Aggregator view: identical items totalled across active tickets, so the line
   * can prep in batches (e.g. 5 burgers, 3 fries).
   */
  async getAggregator(locationId: string) {
    const lines = await this.prisma.kitchenTicketLine.findMany({
      where: {
        ticket: { locationId, status: { in: ['QUEUED', 'IN_PREP'] } },
        status: { in: ['QUEUED', 'IN_PREP'] },
      },
      include: { roundItem: { include: { menuItem: true } } },
    });
    const totals = new Map<string, { name: string; quantity: number }>();
    for (const line of lines) {
      const name = line.roundItem.menuItem.name;
      const entry = totals.get(name) ?? { name, quantity: 0 };
      entry.quantity += line.roundItem.quantity;
      totals.set(name, entry);
    }
    return [...totals.values()].sort((a, b) => b.quantity - a.quantity);
  }

  /** Move a ticket QUEUED -> IN_PREP -> READY. */
  async setStatus(ticketId: string, status: TicketStatus) {
    if (status !== TicketStatus.IN_PREP && status !== TicketStatus.READY) {
      throw new BadRequestException('use the serve endpoint to mark SERVED');
    }
    const ticket = await this.prisma.kitchenTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('ticket not found');

    const updated = await this.prisma.kitchenTicket.update({
      where: { id: ticketId },
      data: { status },
    });

    if (status === TicketStatus.IN_PREP) {
      const round = await this.prisma.round.findUnique({
        where: { id: ticket.roundId },
        include: { session: true },
      });
      if (round) {
        await this.prisma.restaurantTable.update({
          where: { id: round.session.tableId },
          data: { floorState: TableFloorState.FOOD_RUNNING },
        });
        this.realtime.emitTableState(
          ticket.locationId,
          round.session.tableId,
          TableFloorState.FOOD_RUNNING,
        );
      }
    }

    this.realtime.emitTicketStatus(ticket.locationId, { ticketId, status });
    return updated;
  }

  async bumpLine(lineId: string, status: TicketStatus) {
    const line = await this.prisma.kitchenTicketLine.findUnique({
      where: { id: lineId },
      include: { ticket: true },
    });
    if (!line) throw new NotFoundException('ticket line not found');
    const updated = await this.prisma.kitchenTicketLine.update({
      where: { id: lineId },
      data: { status },
    });
    this.realtime.emitTicketStatus(line.ticket.locationId, {
      ticketId: line.ticketId,
      lineId,
      status,
    });
    return updated;
  }

  /**
   * Runner delivered. Ticket -> SERVED, round -> SERVED. If that was the table's
   * last open round, the session auto-settles (the table is already square
   * because of pay-before-fire).
   */
  async serve(ticketId: string) {
    const ticket = await this.prisma.kitchenTicket.findUnique({
      where: { id: ticketId },
      include: { round: { include: { session: true } } },
    });
    if (!ticket) throw new NotFoundException('ticket not found');

    await this.prisma.$transaction([
      this.prisma.kitchenTicket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.SERVED, servedAt: new Date() },
      }),
      this.prisma.round.update({
        where: { id: ticket.roundId },
        data: { status: RoundStatus.SERVED },
      }),
    ]);

    this.realtime.emitTicketServed(ticket.locationId, {
      ticketId,
      tableId: ticket.round.session.tableId,
    });

    // Best-effort auto-settle when nothing is outstanding.
    try {
      await this.sessions.settle(ticket.round.sessionId);
    } catch {
      this.logger.debug(`session ${ticket.round.sessionId} not yet settleable`);
    }
    return { ticketId, status: TicketStatus.SERVED };
  }
}
