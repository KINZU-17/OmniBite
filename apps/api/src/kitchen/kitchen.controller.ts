import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { KitchenService } from './kitchen.service';
import { BumpLineDto, SetTicketStatusDto } from './dto';
import { StaffGuard } from '../auth/staff.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller()
@UseGuards(StaffGuard, RolesGuard)
@Roles('KITCHEN', 'MANAGER', 'SERVER')
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get('locations/:locationId/kitchen/board')
  board(@Param('locationId') locationId: string) {
    return this.kitchen.getBoard(locationId);
  }

  @Get('locations/:locationId/kitchen/aggregator')
  aggregator(@Param('locationId') locationId: string) {
    return this.kitchen.getAggregator(locationId);
  }

  @Patch('kitchen/tickets/:id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetTicketStatusDto) {
    return this.kitchen.setStatus(id, dto.status);
  }

  @Patch('kitchen/lines/:id/status')
  bumpLine(@Param('id') id: string, @Body() dto: BumpLineDto) {
    return this.kitchen.bumpLine(id, dto.status);
  }

  @Post('kitchen/tickets/:id/serve')
  serve(@Param('id') id: string) {
    return this.kitchen.serve(id);
  }
}
