import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { Rooms } from './events';

/** What a connect handshake may carry, and what we stash on socket.data. */
interface HandshakeAuth {
  staffId?: string;
  locationId?: string;
  rooms?: string[];
}
interface SocketData {
  locationId?: string;
  staffId?: string;
}

/**
 * Single Socket.io gateway for the floor app, KDS, and admin dashboard. Carries
 * events only; Postgres holds state. Emits are always scoped to a per-location
 * room, never broadcast to every client.
 *
 * Auth note: every socket authenticates on connect. Phase 1 validates a staff id
 * against the DB (active staff) for kitchen/floor rooms, and allows read-only
 * guest joins to a location's floor room for live menu 86 updates. Signed-token
 * verification and the full role matrix are Phase 2.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly prisma: PrismaService) {}

  async handleConnection(client: Socket): Promise<void> {
    const auth = (client.handshake.auth ?? {}) as HandshakeAuth;
    const staffId = auth.staffId;
    const guestLocationId = auth.locationId;
    const requested = auth.rooms ?? ['floor'];
    const data = client.data as SocketData;

    try {
      if (staffId) {
        const staff = await this.prisma.staff.findFirst({
          where: { id: staffId, active: true },
        });
        if (!staff) {
          client.emit('error', { message: 'unauthorized' });
          client.disconnect(true);
          return;
        }
        data.locationId = staff.locationId;
        data.staffId = staff.id;
        for (const room of requested) {
          if (room === 'kitchen') client.join(Rooms.kitchen(staff.locationId));
          if (room === 'floor') client.join(Rooms.floor(staff.locationId));
        }
      } else if (guestLocationId) {
        // Diner device: read-only, only the floor room for live 86 updates.
        data.locationId = guestLocationId;
        client.join(Rooms.floor(guestLocationId));
      } else {
        client.disconnect(true);
        return;
      }
    } catch (err) {
      this.logger.error(`connection error: ${String(err)}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`disconnect ${client.id}`);
  }

  /**
   * Reconnect / offline survival: the KDS tracks the last ticket it saw and asks
   * the backend to replay anything fired since. Tickets live in Postgres, so a
   * dropped socket delays delivery but never loses a paid ticket.
   */
  @SubscribeMessage('kds.replay')
  async replay(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { since?: string },
  ): Promise<{ tickets: unknown[] }> {
    const locationId = (client.data as SocketData).locationId;
    if (!locationId) return { tickets: [] };
    const since = body?.since ? new Date(body.since) : new Date(0);
    const tickets = await this.prisma.kitchenTicket.findMany({
      where: {
        locationId,
        status: { in: ['QUEUED', 'IN_PREP', 'READY'] },
        firedAt: { gt: since },
      },
      include: {
        lines: { include: { roundItem: { include: { menuItem: true } } } },
      },
      orderBy: { firedAt: 'asc' },
    });
    return { tickets };
  }

  emit(room: string, event: string, payload: unknown): void {
    this.server.to(room).emit(event, payload);
  }
}
