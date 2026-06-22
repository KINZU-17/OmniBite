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
import { MenuService } from './menu.service';
import { CreateMenuItemDto, Toggle86Dto, UpdateMenuItemDto } from './dto';
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

  /** Admin/manager: add a menu item (name, price, photo, allergens). */
  @Post('menu-items')
  @UseGuards(StaffGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  create(@Body() dto: CreateMenuItemDto, @CurrentStaff() staff: Staff) {
    return this.menu.createItem(dto, staff);
  }

  /** Admin/manager: edit a menu item (price, name, photo, …). */
  @Patch('menu-items/:id')
  @UseGuards(StaffGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMenuItemDto,
    @CurrentStaff() staff: Staff,
  ) {
    return this.menu.updateItem(id, dto, staff);
  }

  /** Admin/manager: remove a menu item that has no order history. */
  @Delete('menu-items/:id')
  @UseGuards(StaffGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  remove(@Param('id') id: string, @CurrentStaff() staff: Staff) {
    return this.menu.deleteItem(id, staff);
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
