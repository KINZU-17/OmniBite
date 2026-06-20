import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Db } from '../common/db';

export interface AuditEntry {
  locationId: string;
  staffId?: string | null;
  action: string; // VOID, COMP, REFUND, PRICE_OVERRIDE, TOGGLE_86, ...
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Append-only audit log for every sensitive action. Invariant: every refund (and
 * every void/comp/override/86 toggle) writes one entry, with who and when.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        locationId: entry.locationId,
        staffId: entry.staffId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: (entry.before ?? undefined) as never,
        after: (entry.after ?? undefined) as never,
      },
    });
  }
}
