import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Staff } from '@prisma/client';
import { SessionsService } from './sessions.service';
import { JoinDto, ScanDto } from './dto';
import { StaffGuard } from '../auth/staff.guard';
import { CurrentStaff } from '../auth/current-staff.decorator';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** Diner scans the table QR. Opens or joins the table session. */
  @Post('scan')
  scan(@Body() dto: ScanDto) {
    return this.sessions.scanAndJoin(dto);
  }

  @Post(':id/join')
  join(@Param('id') id: string, @Body() dto: JoinDto) {
    return this.sessions.join(id, dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sessions.getSession(id);
  }

  @Post(':id/needs-bussing')
  @UseGuards(StaffGuard)
  bussing(@Param('id') id: string, @CurrentStaff() staff: Staff) {
    return this.sessions.markNeedsBussing(id, staff);
  }

  @Post(':id/close')
  @UseGuards(StaffGuard)
  close(@Param('id') id: string, @CurrentStaff() staff: Staff) {
    return this.sessions.close(id, staff);
  }
}
