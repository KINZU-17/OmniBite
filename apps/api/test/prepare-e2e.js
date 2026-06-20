/**
 * One-time setup for the e2e suite (run by `test:e2e` before jest, in plain JS so
 * no ts-jest transform is needed): create the omnibite_test database if missing,
 * sync the Prisma schema into it, and apply the partial indexes Prisma can't
 * express. Idempotent — safe to run on every test invocation.
 */
const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PrismaClient } = require('@prisma/client');

const ADMIN_URL =
  process.env.DATABASE_URL_ADMIN ||
  'postgresql://omnibite:omnibite@localhost:5432/omnibite';
const TEST_URL =
  process.env.DATABASE_URL_TEST ||
  'postgresql://omnibite:omnibite@localhost:5432/omnibite_test';

async function main() {
  const apiRoot = join(__dirname, '..');

  // 1. Create the test database (no IF NOT EXISTS for CREATE DATABASE).
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE omnibite_test');
    console.log('[e2e] created database omnibite_test');
  } catch (err) {
    if (String(err).includes('already exists')) {
      console.log('[e2e] database omnibite_test already exists');
    } else {
      throw err;
    }
  } finally {
    await admin.$disconnect();
  }

  // 2. Sync the schema into the test database.
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: 'inherit',
  });

  // 3. Apply partial indexes (idempotent: CREATE INDEX IF NOT EXISTS).
  const sql = readFileSync(join(apiRoot, 'prisma/sql/partial-indexes.sql'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const test = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await test.$executeRawUnsafe(stmt);
    }
    console.log('[e2e] partial indexes applied');
  } finally {
    await test.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
