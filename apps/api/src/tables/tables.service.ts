import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Staff } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateTableDto, UpdateTableDto } from './dto';

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Tables for a location, with their QR token, in table-number order. */
  list(locationId: string) {
    return this.prisma.restaurantTable.findMany({
      where: { locationId },
      orderBy: { tableNumber: 'asc' },
      select: {
        id: true,
        tableNumber: true,
        qrToken: true,
        floorState: true,
      },
    });
  }

  /** Add a table; its QR token is generated server-side and is unique. */
  async create(dto: CreateTableDto, staff: Staff) {
    const clash = await this.prisma.restaurantTable.findUnique({
      where: {
        locationId_tableNumber: {
          locationId: dto.locationId,
          tableNumber: dto.tableNumber,
        },
      },
    });
    if (clash) {
      throw new BadRequestException(`table ${dto.tableNumber} already exists`);
    }
    const table = await this.prisma.restaurantTable.create({
      data: {
        locationId: dto.locationId,
        tableNumber: dto.tableNumber,
        qrToken: this.freshToken(),
      },
    });
    await this.audit.log({
      locationId: dto.locationId,
      staffId: staff.id,
      action: 'TABLE_CREATE',
      entityType: 'restaurant_table',
      entityId: table.id,
      after: { tableNumber: table.tableNumber },
    });
    return table;
  }

  /** Rename a table (its QR token is unchanged, so printed codes still work). */
  async rename(id: string, dto: UpdateTableDto, staff: Staff) {
    const table = await this.prisma.restaurantTable.findUnique({
      where: { id },
    });
    if (!table) throw new NotFoundException('table not found');
    try {
      const updated = await this.prisma.restaurantTable.update({
        where: { id },
        data: { tableNumber: dto.tableNumber },
      });
      await this.audit.log({
        locationId: table.locationId,
        staffId: staff.id,
        action: 'TABLE_RENAME',
        entityType: 'restaurant_table',
        entityId: id,
        before: { tableNumber: table.tableNumber },
        after: { tableNumber: updated.tableNumber },
      });
      return updated;
    } catch {
      throw new BadRequestException(
        `a table numbered ${dto.tableNumber} already exists`,
      );
    }
  }

  /** Rotate a table's QR token, invalidating any previously printed code. */
  async rotateToken(id: string, staff: Staff) {
    const table = await this.prisma.restaurantTable.findUnique({
      where: { id },
    });
    if (!table) throw new NotFoundException('table not found');
    const updated = await this.prisma.restaurantTable.update({
      where: { id },
      data: { qrToken: this.freshToken() },
    });
    await this.audit.log({
      locationId: table.locationId,
      staffId: staff.id,
      action: 'TABLE_ROTATE_TOKEN',
      entityType: 'restaurant_table',
      entityId: id,
    });
    return updated;
  }

  /** Remove a table that is neither occupied nor carrying session history. */
  async remove(id: string, staff: Staff) {
    const table = await this.prisma.restaurantTable.findUnique({
      where: { id },
    });
    if (!table) throw new NotFoundException('table not found');
    if (table.currentSessionId) {
      throw new BadRequestException(
        'table is occupied; close its session before deleting',
      );
    }
    const sessions = await this.prisma.tableSession.count({
      where: { tableId: id },
    });
    if (sessions > 0) {
      throw new BadRequestException(
        'table has session history and cannot be deleted',
      );
    }
    await this.prisma.restaurantTable.delete({ where: { id } });
    await this.audit.log({
      locationId: table.locationId,
      staffId: staff.id,
      action: 'TABLE_DELETE',
      entityType: 'restaurant_table',
      entityId: id,
      before: { tableNumber: table.tableNumber },
    });
    return { deleted: true };
  }

  /** A URL-safe, unguessable token. (Phase 2 signs/validates this.) */
  private freshToken(): string {
    return `t_${randomBytes(12).toString('base64url')}`;
  }
}
