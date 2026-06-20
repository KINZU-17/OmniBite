import { Module } from '@nestjs/common';
import { EtimsClient } from './etims.client';
import { EtimsService } from './etims.service';
import { EtimsController } from './etims.controller';

@Module({
  providers: [EtimsClient, EtimsService],
  controllers: [EtimsController],
  exports: [EtimsService],
})
export class EtimsModule {}
