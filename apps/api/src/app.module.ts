import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { GateModule } from './gate/gate.module';
import { MenuModule } from './menu/menu.module';
import { SessionsModule } from './sessions/sessions.module';
import { MpesaModule } from './mpesa/mpesa.module';
import { PaymentsModule } from './payments/payments.module';
import { RoundsModule } from './rounds/rounds.module';
import { KitchenModule } from './kitchen/kitchen.module';
import { EtimsModule } from './etims/etims.module';
import { RefundsModule } from './refunds/refunds.module';
import { ReconModule } from './recon/recon.module';

@Module({
  imports: [
    // Infrastructure
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    RealtimeModule,
    AuditModule,
    AuthModule,
    GateModule,
    // Domain
    MenuModule,
    SessionsModule,
    MpesaModule,
    PaymentsModule,
    RoundsModule,
    KitchenModule,
    EtimsModule,
    RefundsModule,
    ReconModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
