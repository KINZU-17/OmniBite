import { Module } from '@nestjs/common';
import { GateModule } from '../gate/gate.module';
import { MpesaModule } from '../mpesa/mpesa.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [GateModule, MpesaModule],
  providers: [PaymentsService],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
