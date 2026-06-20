import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import type { Staff } from '@prisma/client';
import { RefundsService } from './refunds.service';
import { RequestRefundDto, ResolveRefundDto } from './dto';
import { StaffGuard } from '../auth/staff.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentStaff } from '../auth/current-staff.decorator';

@Controller('refunds')
@UseGuards(StaffGuard, RolesGuard)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  /** Any staff with refund rights can request; reason-coded. */
  @Post()
  @Roles('SERVER', 'MANAGER')
  request(@Body() dto: RequestRefundDto, @CurrentStaff() staff: Staff) {
    return this.refunds.request(dto, staff);
  }

  /** Manager PIN / role required to approve. */
  @Post(':id/approve')
  @Roles('MANAGER')
  approve(@Param('id') id: string, @CurrentStaff() staff: Staff) {
    return this.refunds.approve(id, staff);
  }

  @Post(':id/resolve')
  @Roles('MANAGER')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveRefundDto,
    @CurrentStaff() staff: Staff,
  ) {
    return this.refunds.resolve(id, dto, staff);
  }
}
