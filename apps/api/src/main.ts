import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // REST CORS — explicit origins in production (no wildcard), open in dev.
  const origins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim());
  app.enableCors({ origin: origins ?? true, credentials: true });

  // Validate and strip unknown fields on all incoming DTOs.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Multi-instance socket fan-out, only when Redis is configured.
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const adapter = new RedisIoAdapter(app);
    adapter.connectToRedis(redisUrl);
  }

  // Allow Prisma's onModuleDestroy to run on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
