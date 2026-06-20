import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
} from '@nestjs/common';
import { RoundsService } from './rounds.service';
import { AddItemDto } from './dto';
import { SubmitRoundDto } from '../payments/dto';

@Controller()
export class RoundsController {
  constructor(private readonly rounds: RoundsService) {}

  /** Open (or fetch) the building cart for a session. */
  @Post('sessions/:sessionId/round')
  open(@Param('sessionId') sessionId: string) {
    return this.rounds.getOrCreateBuildingRound(sessionId);
  }

  @Post('rounds/:id/items')
  addItem(@Param('id') id: string, @Body() dto: AddItemDto) {
    return this.rounds.addItem(id, dto);
  }

  @Delete('rounds/:id/items/:itemId')
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.rounds.removeItem(id, itemId);
  }

  /** Send the round and create the payment requests. */
  @Post('rounds/:id/submit')
  submit(@Param('id') id: string, @Body() dto: SubmitRoundDto) {
    return this.rounds.submit(id, dto);
  }

  @Post('rounds/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.rounds.cancel(id);
  }
}
