import { Global, Module } from '@nestjs/common';
import { StaffGuard } from './staff.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [StaffGuard, RolesGuard],
  exports: [StaffGuard, RolesGuard],
})
export class AuthModule {}
