import { Module } from '@nestjs/common';
import { GateModule } from '../gate/gate.module';
import { PaymentsModule } from '../payments/payments.module';
import { RoundsService } from './rounds.service';
import { RoundsController } from './rounds.controller';

@Module({
  imports: [PaymentsModule, GateModule],
  providers: [RoundsService],
  controllers: [RoundsController],
  exports: [RoundsService],
})
export class RoundsModule {}
