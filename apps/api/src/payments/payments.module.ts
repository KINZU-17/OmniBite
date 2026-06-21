import { Module } from '@nestjs/common';
import { GateModule } from '../gate/gate.module';
import { MpesaModule } from '../mpesa/mpesa.module';
import { PesapalModule } from '../pesapal/pesapal.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [GateModule, MpesaModule, PesapalModule],
  providers: [PaymentsService],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
