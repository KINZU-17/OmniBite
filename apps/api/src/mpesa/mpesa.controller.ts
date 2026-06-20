import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { MpesaService } from './mpesa.service';

@Controller('mpesa')
export class MpesaController {
  constructor(private readonly mpesa: MpesaService) {}

  /**
   * Daraja posts the STK result here. Acknowledge fast with 200; the heavy work
   * (idempotent confirm + firing) runs inside handleCallback. Always 200 so
   * Safaricom does not retry a callback we have accepted.
   */
  @Post('callback')
  @HttpCode(200)
  async callback(@Body() body: unknown): Promise<{ ResultCode: number; ResultDesc: string }> {
    await this.mpesa.handleCallback(body);
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }
}
