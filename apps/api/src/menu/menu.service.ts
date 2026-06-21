import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Staff } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RefundsService } from '../refunds/refunds.service';

@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly refunds: RefundsService,
  ) {}

  /** The live menu for a location, including allergens and modifiers. */
  getMenu(locationId: string) {
    return this.prisma.menuItem.findMany({
      where: { locationId },
      include: {
        allergens: true,
        modifierGroups: {
          include: { modifierGroup: { include: { modifiers: true } } },
        },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Real-time 86ing. Toggling availability greys the item out across every
   * active and incoming order at that location. Also writes an audit entry,
   * since 86ing is a controlled action.
   */
  async toggle86(menuItemId: string, is86: boolean, staff: Staff) {
    const item = await this.prisma.menuItem.findUnique({
      where: { id: menuItemId },
    });
    if (!item) throw new NotFoundException('menu item not found');

    const updated = await this.prisma.menuItem.update({
      where: { id: menuItemId },
      data: { is86 },
    });

    await this.audit.log({
      locationId: item.locationId,
      staffId: staff.id,
      action: 'TOGGLE_86',
      entityType: 'menu_item',
      entityId: menuItemId,
      before: { is86: item.is86 },
      after: { is86 },
    });

    this.realtime.emitItem86(item.locationId, menuItemId, is86);

    // Invariant 7: an item 86ed after payment is auto-refunded. Find paid-but-
    // unserved (FIRED) round items of this menu item and issue store credit.
    if (is86) await this.autoRefundFiredItems(menuItemId);

    return updated;
  }

  private async autoRefundFiredItems(menuItemId: string): Promise<void> {
    const fired = await this.prisma.roundItem.findMany({
      where: { menuItemId, status: 'ACTIVE', round: { status: 'FIRED' } },
      select: { id: true },
    });
    for (const item of fired) {
      await this.refunds
        .autoRefundItem(item.id)
        .catch((e) =>
          this.logger.warn(`auto-refund failed for ${item.id}: ${String(e)}`),
        );
    }
  }
}
