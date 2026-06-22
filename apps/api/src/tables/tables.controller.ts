import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Staff } from '@prisma/client';
import { TablesService } from './tables.service';
import { CreateTableDto, UpdateTableDto } from './dto';
import { StaffGuard } from '../auth/staff.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentStaff } from '../auth/current-staff.decorator';

/** Table + QR management. All endpoints are admin/manager only. */
@Controller()
@UseGuards(StaffGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get('locations/:locationId/tables')
  list(@Param('locationId') locationId: string) {
    return this.tables.list(locationId);
  }

  @Post('tables')
  create(@Body() dto: CreateTableDto, @CurrentStaff() staff: Staff) {
    return this.tables.create(dto, staff);
  }

  @Patch('tables/:id')
  rename(
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
    @CurrentStaff() staff: Staff,
  ) {
    return this.tables.rename(id, dto, staff);
  }

  @Post('tables/:id/rotate-token')
  rotate(@Param('id') id: string, @CurrentStaff() staff: Staff) {
    return this.tables.rotateToken(id, staff);
  }

  @Delete('tables/:id')
  remove(@Param('id') id: string, @CurrentStaff() staff: Staff) {
    return this.tables.remove(id, staff);
  }
}
