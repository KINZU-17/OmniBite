import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EtimsService } from './etims.service';
import { StaffGuard } from '../auth/staff.guard';

@Controller('etims')
export class EtimsController {
  constructor(
    private readonly etims: EtimsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Fiscal data for the diner's receipt (KRA invoice number + QR). */
  @Get('invoices/:id')
  async get(@Param('id') id: string) {
    const invoice = await this.prisma.etimsInvoice.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!invoice) throw new NotFoundException('invoice not found');
    return invoice;
  }

  /** Force a retransmit (staff). The worker also retries automatically. */
  @Post('invoices/:id/retry')
  @UseGuards(StaffGuard)
  async retry(@Param('id') id: string) {
    await this.etims.transmit(id);
    return { ok: true };
  }
}
