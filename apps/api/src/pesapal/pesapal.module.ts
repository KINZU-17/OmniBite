import { Module } from '@nestjs/common';
import { GateModule } from '../gate/gate.module';
import { PesapalClient } from './pesapal.client';
import { PesapalService } from './pesapal.service';
import { PesapalController } from './pesapal.controller';

@Module({
  imports: [GateModule],
  providers: [PesapalClient, PesapalService],
  controllers: [PesapalController],
  exports: [PesapalService, PesapalClient],
})
export class PesapalModule {}
