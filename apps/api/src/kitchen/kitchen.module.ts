import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { KitchenService } from './kitchen.service';
import { KitchenController } from './kitchen.controller';

@Module({
  imports: [SessionsModule],
  providers: [KitchenService],
  controllers: [KitchenController],
  exports: [KitchenService],
})
export class KitchenModule {}
