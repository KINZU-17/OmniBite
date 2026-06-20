import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { Staff } from '@prisma/client';
import { MenuService } from './menu.service';
import { Toggle86Dto } from './dto';
import { StaffGuard } from '../auth/staff.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentStaff } from '../auth/current-staff.decorator';

@Controller()
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  /** Public: diners read the live menu for a location. */
  @Get('locations/:locationId/menu')
  getMenu(@Param('locationId') locationId: string) {
    return this.menu.getMenu(locationId);
  }

  /** Staff: 86 / un-86 an item. Kitchen, manager, or admin. */
  @Patch('menu-items/:id/availability')
  @UseGuards(StaffGuard, RolesGuard)
  @Roles('KITCHEN', 'MANAGER')
  toggle86(
    @Param('id') id: string,
    @Body() dto: Toggle86Dto,
    @CurrentStaff() staff: Staff,
  ) {
    return this.menu.toggle86(id, dto.is86, staff);
  }
}
