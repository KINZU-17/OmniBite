import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { CashDrawerService } from './cash-drawer.service';
import { ReconController } from './recon.controller';

@Module({
  providers: [ReconciliationService, CashDrawerService],
  controllers: [ReconController],
  exports: [ReconciliationService, CashDrawerService],
})
export class ReconModule {}
