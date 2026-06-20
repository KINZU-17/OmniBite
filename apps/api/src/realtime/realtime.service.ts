import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';
import { Events, InternalEvents, Rooms } from './events';
import type { RoundPaidEvent } from './events';

/**
 * Translates domain events into scoped socket emissions. Other modules call the
 * explicit emit* methods; the PAID gate is handled via the in-process
 * `round.paid` event so firing stays decoupled from delivery.
 */
@Injectable()
export class RealtimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
  ) {}

  @OnEvent(InternalEvents.ROUND_PAID)
  async onRoundPaid(evt: RoundPaidEvent): Promise<void> {
    const ticket = await this.prisma.kitchenTicket.findUnique({
      where: { id: evt.ticketId },
      include: {
        lines: { include: { roundItem: { include: { menuItem: true } } } },
      },
    });
    if (ticket) {
      this.gateway.emit(Rooms.kitchen(evt.locationId), Events.TICKET_FIRED, ticket);
    }
    this.emitTableState(evt.locationId, evt.tableId, 'PAID');
  }

  emitTicketStatus(locationId: string, payload: unknown): void {
    this.gateway.emit(Rooms.kitchen(locationId), Events.TICKET_STATUS, payload);
    this.gateway.emit(Rooms.floor(locationId), Events.TICKET_STATUS, payload);
  }

  emitTicketServed(locationId: string, payload: unknown): void {
    this.gateway.emit(Rooms.kitchen(locationId), Events.TICKET_SERVED, payload);
    this.gateway.emit(Rooms.floor(locationId), Events.TICKET_SERVED, payload);
  }

  /** 86 changes go to the floor and to live diner menus (both in the floor room). */
  emitItem86(locationId: string, menuItemId: string, is86: boolean): void {
    this.gateway.emit(Rooms.floor(locationId), Events.ITEM_86, { menuItemId, is86 });
  }

  emitTableState(locationId: string, tableId: string, state: string): void {
    this.gateway.emit(Rooms.floor(locationId), Events.TABLE_STATE, { tableId, state });
  }
}
