import { Module } from '@nestjs/common';
import { EtimsModule } from '../etims/etims.module';
import { MpesaModule } from '../mpesa/mpesa.module';
import { RefundsService } from './refunds.service';
import { RefundsController } from './refunds.controller';

@Module({
  imports: [EtimsModule, MpesaModule],
  providers: [RefundsService],
  controllers: [RefundsController],
  exports: [RefundsService],
})
export class RefundsModule {}
