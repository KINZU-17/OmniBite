import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { ConfirmCardDto, RetryMpesaDto } from './dto';
import { StaffGuard } from '../auth/staff.guard';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Staff records a cash payment (drawer reconciled at end of shift). */
  @Post(':id/cash')
  @UseGuards(StaffGuard)
  cash(@Param('id') id: string) {
    return this.payments.confirmCash(id);
  }

  /** Card captured via the gateway. */
  @Post(':id/card')
  @UseGuards(StaffGuard)
  card(@Param('id') id: string, @Body() dto: ConfirmCardDto) {
    return this.payments.confirmCard(id, dto);
  }

  /** Diner retries a failed M-Pesa push. */
  @Post(':id/retry')
  retry(@Param('id') id: string, @Body() dto: RetryMpesaDto) {
    return this.payments.retryMpesa(id, dto.phone);
  }
}
