import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionStatus, Staff, TableFloorState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { JoinDto, ScanDto } from './dto';

const TERMINAL_ROUND = ['SERVED', 'CANCELLED'];

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Scan the table QR: validate the code server-side, open the table's session
   * if none is active (or reuse the active one — everyone at a table shares one
   * session), and add the scanning diner as a tagged participant.
   */
  async scanAndJoin(dto: ScanDto) {
    const table = await this.prisma.restaurantTable.findUnique({
      where: { qrToken: dto.qrToken },
    });
    if (!table) throw new NotFoundException('invalid table code');

    return this.prisma.$transaction(async (tx) => {
      let sessionId = table.currentSessionId;

      // Reuse only if the linked session is still ACTIVE.
      if (sessionId) {
        const existing = await tx.tableSession.findUnique({
          where: { id: sessionId },
        });
        if (!existing || existing.status !== SessionStatus.ACTIVE)
          sessionId = null;
      }

      if (!sessionId) {
        const session = await tx.tableSession.create({
          data: { tableId: table.id, locationId: table.locationId },
        });
        sessionId = session.id;
        await tx.restaurantTable.update({
          where: { id: table.id },
          data: {
            currentSessionId: sessionId,
            floorState: TableFloorState.SEATED,
          },
        });
      }

      const participant = await tx.sessionParticipant.create({
        data: {
          sessionId,
          displayName: dto.displayName,
          phone: dto.phone,
          deviceId: dto.deviceId,
        },
      });

      this.realtime.emitTableState(
        table.locationId,
        table.id,
        TableFloorState.SEATED,
      );
      return {
        sessionId,
        participant,
        locationId: table.locationId,
        tableId: table.id,
      };
    });
  }

  async join(sessionId: string, dto: JoinDto) {
    const session = await this.requireActive(sessionId);
    const participant = await this.prisma.sessionParticipant.create({
      data: {
        sessionId,
        displayName: dto.displayName,
        phone: dto.phone,
        deviceId: dto.deviceId,
      },
    });
    return { participant, locationId: session.locationId };
  }

  /** The diner's live view of the table: participants and every round. */
  getSession(sessionId: string) {
    return this.prisma.tableSession.findUnique({
      where: { id: sessionId },
      include: {
        participants: true,
        rounds: {
          include: {
            items: { include: { menuItem: true, modifiers: true } },
            payments: true,
            kitchenTicket: true,
          },
          orderBy: { id: 'asc' },
        },
      },
    });
  }

  /**
   * ACTIVE -> SETTLED. Allowed only when every round is terminal (served or
   * cancelled). Because of pay-before-fire a served table is always square, so
   * there is no end-of-meal bill step.
   */
  async settle(sessionId: string) {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
      include: { rounds: true },
    });
    if (!session) throw new NotFoundException('session not found');
    if (session.status !== SessionStatus.ACTIVE) return session;

    const open = session.rounds.filter(
      (r) => !TERMINAL_ROUND.includes(r.status),
    );
    if (open.length > 0) {
      throw new BadRequestException('cannot settle: rounds still in progress');
    }
    return this.prisma.tableSession.update({
      where: { id: sessionId },
      data: { status: SessionStatus.SETTLED },
    });
  }

  /** SETTLED -> NEEDS_BUSSING (staff marks the empty table for reset). */
  async markNeedsBussing(sessionId: string, _staff: Staff) {
    void _staff;
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('session not found');

    const updated = await this.prisma.tableSession.update({
      where: { id: sessionId },
      data: { status: SessionStatus.NEEDS_BUSSING },
    });
    await this.prisma.restaurantTable.update({
      where: { id: session.tableId },
      data: { floorState: TableFloorState.NEEDS_BUSSING },
    });
    this.realtime.emitTableState(
      session.locationId,
      session.tableId,
      TableFloorState.NEEDS_BUSSING,
    );
    return updated;
  }

  /** NEEDS_BUSSING -> CLOSED, table freed. */
  async close(sessionId: string, _staff: Staff) {
    void _staff;
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('session not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tableSession.update({
        where: { id: sessionId },
        data: { status: SessionStatus.CLOSED, closedAt: new Date() },
      });
      await tx.restaurantTable.update({
        where: { id: session.tableId },
        data: { floorState: TableFloorState.OPEN, currentSessionId: null },
      });
      this.realtime.emitTableState(
        session.locationId,
        session.tableId,
        TableFloorState.OPEN,
      );
      return updated;
    });
  }

  private async requireActive(sessionId: string) {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('session not found');
    if (session.status !== SessionStatus.ACTIVE) {
      throw new BadRequestException('session is not active');
    }
    return session;
  }
}
