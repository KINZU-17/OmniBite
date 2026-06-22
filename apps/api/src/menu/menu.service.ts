import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Staff } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RefundsService } from '../refunds/refunds.service';
import type { CreateMenuItemDto, UpdateMenuItemDto } from './dto';

const MENU_INCLUDE = {
  allergens: true,
  modifierGroups: {
    include: { modifierGroup: { include: { modifiers: true } } },
  },
} as const;

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
      include: MENU_INCLUDE,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Admin/manager adds a menu item (name, price, photo, allergens). eTIMS needs
   * an item_code on every line, so we generate a stable one when none is given.
   */
  async createItem(dto: CreateMenuItemDto, staff: Staff) {
    const created = await this.prisma.menuItem.create({
      data: {
        locationId: dto.locationId,
        name: dto.name,
        basePrice: dto.basePrice,
        category: dto.category ?? null,
        description: dto.description ?? null,
        photoUrl: dto.photoUrl ?? null,
        itemCode: dto.itemCode?.trim() || this.generateItemCode(dto.category),
        allergens: dto.allergens?.length
          ? { create: dto.allergens.map((allergen) => ({ allergen })) }
          : undefined,
      },
      include: MENU_INCLUDE,
    });

    await this.audit.log({
      locationId: created.locationId,
      staffId: staff.id,
      action: 'MENU_ITEM_CREATE',
      entityType: 'menu_item',
      entityId: created.id,
      after: {
        name: created.name,
        basePrice: created.basePrice,
        itemCode: created.itemCode,
      },
    });
    return created;
  }

  /** Edit name/price/category/description/photo and (if sent) replace allergens. */
  async updateItem(id: string, dto: UpdateMenuItemDto, staff: Staff) {
    const item = await this.prisma.menuItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('menu item not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.allergens) {
        await tx.menuItemAllergen.deleteMany({ where: { menuItemId: id } });
        if (dto.allergens.length) {
          await tx.menuItemAllergen.createMany({
            data: dto.allergens.map((allergen) => ({
              menuItemId: id,
              allergen,
            })),
          });
        }
      }
      return tx.menuItem.update({
        where: { id },
        data: {
          name: dto.name,
          basePrice: dto.basePrice,
          category: dto.category,
          description: dto.description,
          photoUrl: dto.photoUrl,
        },
        include: MENU_INCLUDE,
      });
    });

    await this.audit.log({
      locationId: item.locationId,
      staffId: staff.id,
      action: 'MENU_ITEM_UPDATE',
      entityType: 'menu_item',
      entityId: id,
      before: { name: item.name, basePrice: item.basePrice },
      after: { name: updated.name, basePrice: updated.basePrice },
    });
    return updated;
  }

  /**
   * Delete a menu item. An item that already appears on an order is kept for
   * the audit/tax trail — 86 it instead. Removing one with no order history
   * also clears its allergen and modifier-group links first (FK constraints).
   */
  async deleteItem(id: string, staff: Staff) {
    const item = await this.prisma.menuItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('menu item not found');

    const referenced = await this.prisma.roundItem.count({
      where: { menuItemId: id },
    });
    if (referenced > 0) {
      throw new BadRequestException(
        'this item appears on past orders; mark it unavailable (86) instead of deleting',
      );
    }

    await this.prisma.$transaction([
      this.prisma.menuItemAllergen.deleteMany({ where: { menuItemId: id } }),
      this.prisma.menuItemModifierGroup.deleteMany({
        where: { menuItemId: id },
      }),
      this.prisma.menuItem.delete({ where: { id } }),
    ]);

    await this.audit.log({
      locationId: item.locationId,
      staffId: staff.id,
      action: 'MENU_ITEM_DELETE',
      entityType: 'menu_item',
      entityId: id,
      before: { name: item.name, basePrice: item.basePrice },
    });
    return { deleted: true };
  }

  private generateItemCode(category?: string | null): string {
    const prefix =
      (category ?? 'ITEM')
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 4) || 'ITEM';
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `KE-${prefix}-${suffix}`;
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
