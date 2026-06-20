import { Module } from '@nestjs/common';
import { SettlementService } from './settlement.service';

/**
 * The PAID gate. Isolated in its own module so PaymentsModule and MpesaModule can
 * both depend on it without a circular import.
 */
@Module({
  providers: [SettlementService],
  exports: [SettlementService],
})
export class GateModule {}
