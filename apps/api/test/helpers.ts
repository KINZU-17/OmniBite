import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import type { StaffRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Boot the full Nest app in-process against the test database. Mirrors main.ts's
 * global ValidationPipe so DTO validation behaves identically, and stops the
 * @Cron workers so tests are deterministic — the reapers are invoked directly
 * where a spec needs them. `customize` lets a spec override providers (e.g. mock
 * an external gateway client).
 */
export async function bootstrap(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<{ app: INestApplication; prisma: PrismaService }> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (customize) builder = customize(builder);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  const scheduler = app.get(SchedulerRegistry);
  for (const job of scheduler.getCronJobs().values()) job.stop();

  return { app, prisma: app.get(PrismaService) };
}

/** Wipe every table so each test starts from a known-empty database. */
export async function resetDb(prisma: PrismaService): Promise<void> {
  // Safety net: TRUNCATE is destructive, so never run it against anything but the
  // dedicated test database, no matter how env wiring drifts.
  const [{ current_database: db }] = await prisma.$queryRawUnsafe<
    Array<{ current_database: string }>
  >(`SELECT current_database()`);
  if (!db.includes('test')) {
    throw new Error(`resetDb refusing to TRUNCATE non-test database "${db}"`);
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  if (tables) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`,
    );
  }
}

/**
 * Minimal reference data: one location, one staff member per role, one table,
 * and two menu items (Fries 350 / Soda 200). Returns the created rows so specs
 * can reference ids without re-querying.
 */
export async function seedFixtures(prisma: PrismaService) {
  const location = await prisma.location.create({
    data: {
      groupId: randomUUID(),
      name: 'Test Location',
      kraPin: 'P051234567A',
      mpesaShortcode: '174379',
    },
  });

  const mkStaff = (role: StaffRole) =>
    prisma.staff.create({
      data: {
        locationId: location.id,
        name: `${role} Test`,
        role,
        pinHash: 'test',
      },
    });
  const [admin, manager, server, kitchen] = await Promise.all([
    mkStaff('ADMIN'),
    mkStaff('MANAGER'),
    mkStaff('SERVER'),
    mkStaff('KITCHEN'),
  ]);

  const table = await prisma.restaurantTable.create({
    data: { locationId: location.id, tableNumber: '1', qrToken: 'test-qr-1' },
  });

  const fries = await prisma.menuItem.create({
    data: {
      locationId: location.id,
      name: 'Fries',
      category: 'Fry',
      basePrice: 350,
      itemCode: 'KE-FOOD-0003',
    },
  });
  const soda = await prisma.menuItem.create({
    data: {
      locationId: location.id,
      name: 'Soda',
      category: 'Cold',
      basePrice: 200,
      itemCode: 'KE-DRINK-0001',
    },
  });

  return {
    location,
    table,
    staff: { admin, manager, server, kitchen },
    items: { fries, soda },
  };
}

export type Fixtures = Awaited<ReturnType<typeof seedFixtures>>;
