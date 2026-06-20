import { Module } from '@nestjs/common';
import { GateModule } from '../gate/gate.module';
import { MpesaClient } from './mpesa.client';
import { MpesaService } from './mpesa.service';
import { MpesaController } from './mpesa.controller';

@Module({
  imports: [GateModule],
  providers: [MpesaClient, MpesaService],
  controllers: [MpesaController],
  exports: [MpesaService, MpesaClient],
})
export class MpesaModule {}
