import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sum } from '../common/money';

/**
 * Nightly M-Pesa reconciliation: match the day's confirmed M-Pesa sales recorded
 * by OmniBite against the M-Pesa statement total and flag any mismatch. The
 * statement import is a stub for now (statementTotal defaults to 0 and the run is
 * left unresolved); the manual endpoint sets the real statement total once
 * imported.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async nightly(): Promise<void> {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const locations = await this.prisma.location.findMany({ select: { id: true } });
    for (const loc of locations) {
      await this.runForLocation(loc.id, yesterday).catch((e) =>
        this.logger.error(`reconciliation failed for ${loc.id}: ${String(e)}`),
      );
    }
  }

  async runForLocation(
    locationId: string,
    date: Date,
    statementTotal?: Prisma.Decimal.Value,
  ) {
    const { start, end, runDate } = this.dayWindow(date);

    const payments = await this.prisma.payment.findMany({
      where: {
        method: 'MPESA',
        status: 'CONFIRMED',
        confirmedAt: { gte: start, lt: end },
        round: { session: { locationId } },
      },
      select: { amount: true },
    });
    const systemTotal = sum(payments.map((p) => p.amount));
    const statement = new Prisma.Decimal(statementTotal ?? 0);
    const variance = statement.sub(systemTotal);

    return this.prisma.mpesaReconciliationRun.upsert({
      where: { locationId_runDate: { locationId, runDate } },
      create: {
        locationId,
        runDate,
        statementTotal: statement,
        systemTotal,
        variance,
        resolved: variance.isZero(),
      },
      update: {
        statementTotal: statement,
        systemTotal,
        variance,
        resolved: variance.isZero(),
      },
    });
  }

  private dayWindow(date: Date) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    const start = new Date(Date.UTC(y, m, d));
    const end = new Date(Date.UTC(y, m, d + 1));
    return { start, end, runDate: start };
  }
}
