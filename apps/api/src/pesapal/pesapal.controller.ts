import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { PesapalService } from './pesapal.service';

/**
 * Pesapal IPN endpoint. Pesapal notifies on payment status change as a GET (and
 * sometimes POST) carrying the order tracking id. Acknowledge fast; the heavy
 * work (status query + idempotent confirm) runs in handleIpn. Always reply with
 * Pesapal's expected ack envelope so it does not keep retrying.
 */
@Controller('pesapal')
export class PesapalController {
  constructor(private readonly pesapal: PesapalService) {}

  @Get('ipn')
  @HttpCode(200)
  ipnGet(@Query() q: Record<string, string>) {
    return this.ack(q);
  }

  @Post('ipn')
  @HttpCode(200)
  ipnPost(@Body() b: Record<string, string>, @Query() q: Record<string, string>) {
    return this.ack({ ...q, ...b });
  }

  private async ack(p: Record<string, string>) {
    const orderTrackingId = p.OrderTrackingId ?? p.orderTrackingId ?? '';
    const merchantRef = p.OrderMerchantReference ?? p.orderMerchantReference ?? '';
    const notifType = p.OrderNotificationType ?? p.orderNotificationType ?? 'IPNCHANGE';
    if (orderTrackingId) await this.pesapal.handleIpn(orderTrackingId);
    return {
      orderNotificationType: notifType,
      orderTrackingId,
      orderMerchantReference: merchantRef,
      status: 200,
    };
  }
}
