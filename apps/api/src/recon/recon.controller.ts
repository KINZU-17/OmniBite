import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import type { Staff } from '@prisma/client';
import { ReconciliationService } from './reconciliation.service';
import { CashDrawerService } from './cash-drawer.service';
import { CloseDrawerDto, OpenDrawerDto, RunReconDto } from './dto';
import { StaffGuard } from '../auth/staff.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentStaff } from '../auth/current-staff.decorator';

@Controller()
@UseGuards(StaffGuard, RolesGuard)
export class ReconController {
  constructor(
    private readonly recon: ReconciliationService,
    private readonly drawer: CashDrawerService,
  ) {}

  /** Import a statement total and (re)run reconciliation for a day. */
  @Post('reconciliation/run')
  @Roles('MANAGER')
  run(@Body() dto: RunReconDto) {
    const date = dto.runDate ? new Date(dto.runDate) : new Date();
    return this.recon.runForLocation(dto.locationId, date, dto.statementTotal);
  }

  @Post('cash-drawer/open')
  @Roles('SERVER', 'MANAGER')
  openDrawer(@Body() dto: OpenDrawerDto, @CurrentStaff() staff: Staff) {
    return this.drawer.open(staff, dto.openingFloat);
  }

  @Post('cash-drawer/:id/close')
  @Roles('SERVER', 'MANAGER')
  closeDrawer(
    @Param('id') id: string,
    @Body() dto: CloseDrawerDto,
    @CurrentStaff() staff: Staff,
  ) {
    return this.drawer.close(id, dto.countedTotal, staff);
  }
}
