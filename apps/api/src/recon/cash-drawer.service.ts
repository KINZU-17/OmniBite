import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Staff } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { money, sum } from '../common/money';

/**
 * Server-recorded cash path with end-of-shift drawer reconciliation. Expected
 * cash = opening float + cash payments confirmed during the drawer session;
 * variance = counted - expected.
 */
@Injectable()
export class CashDrawerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  open(staff: Staff, openingFloat: string) {
    return this.prisma.cashDrawerSession.create({
      data: {
        locationId: staff.locationId,
        staffId: staff.id,
        openingFloat: money(openingFloat),
      },
    });
  }

  async close(sessionId: string, countedTotal: string, staff: Staff) {
    const session = await this.prisma.cashDrawerSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('drawer session not found');
    if (session.closedAt) throw new BadRequestException('drawer already closed');

    const now = new Date();
    const cash = await this.prisma.payment.findMany({
      where: {
        method: 'CASH',
        status: 'CONFIRMED',
        confirmedAt: { gte: session.openedAt, lte: now },
        round: { session: { locationId: session.locationId } },
      },
      select: { amount: true },
    });
    const expected = new Prisma.Decimal(session.openingFloat).add(sum(cash.map((p) => p.amount)));
    const counted = money(countedTotal);
    const variance = counted.sub(expected);

    const updated = await this.prisma.cashDrawerSession.update({
      where: { id: sessionId },
      data: { closedAt: now, countedTotal: counted, expectedTotal: expected, variance },
    });
    await this.audit.log({
      locationId: session.locationId,
      staffId: staff.id,
      action: 'CASH_DRAWER_CLOSE',
      entityType: 'cash_drawer_session',
      entityId: sessionId,
      after: { expected: expected.toString(), counted: counted.toString(), variance: variance.toString() },
    });
    return updated;
  }
}
