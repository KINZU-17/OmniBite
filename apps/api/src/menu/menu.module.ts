import { Module } from '@nestjs/common';
import { RefundsModule } from '../refunds/refunds.module';
import { MenuService } from './menu.service';
import { MenuController } from './menu.controller';

@Module({
  imports: [RefundsModule],
  providers: [MenuService],
  controllers: [MenuController],
  exports: [MenuService],
})
export class MenuModule {}
