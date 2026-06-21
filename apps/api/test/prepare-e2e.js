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

// If no external DB is available, try to start an embedded Postgres instance
// (best-effort). This supports local dev where Docker is not installed.
async function maybeStartEmbeddedPostgres() {
  // Allow opting out of embedded Postgres with USE_EMBEDDED_POSTGRES=false
  if (process.env.USE_EMBEDDED_POSTGRES === 'false') {
    console.log('[e2e] USE_EMBEDDED_POSTGRES=false, skipping embedded start');
    return null;
  }
  if (process.env.DATABASE_URL_ADMIN && process.env.DATABASE_URL_TEST) return null;
  let embedded;
  try {
    // attempt to require the embedded-postgres package if present
    // try several common export shapes to maximize compatibility
    // eslint-disable-next-line global-require
    const pkg = require('embedded-postgres');
    if (!pkg) return null;

    // Normalize to an instance with async start()/stop() if possible
    if (typeof pkg === 'function') {
      embedded = pkg({
        port: 5432,
        username: 'omnibite',
        password: 'omnibite',
        database: 'omnibite',
      });
    } else if (pkg.default && typeof pkg.default === 'function') {
      embedded = pkg.default({ port: 5432, username: 'omnibite', password: 'omnibite', database: 'omnibite' });
    } else if (pkg.EmbeddedPostgres) {
      embedded = new pkg.EmbeddedPostgres({ port: 5432, username: 'omnibite', password: 'omnibite', database: 'omnibite' });
    } else if (typeof pkg.start === 'function') {
      embedded = pkg;
    } else {
      console.log('[e2e] embedded-postgres package present but API shape unrecognized');
      return null;
    }

    // start the embedded server (best-effort using start or startSync)
    if (typeof embedded.start === 'function') {
      await embedded.start();
    } else if (typeof embedded.run === 'function') {
      await embedded.run();
    } else if (typeof pkg.start === 'function') {
      // pkg.start may return a handle
      await pkg.start();
    } else {
      console.log('[e2e] embedded-postgres start method not found; skipping');
      return null;
    }

    // If the instance exposes a port, use it; otherwise assume 5432
    const port = (embedded && embedded.port) || 5432;
    const admin = `postgresql://omnibite:omnibite@127.0.0.1:${port}/omnibite`;
    const test = `postgresql://omnibite:omnibite@127.0.0.1:${port}/omnibite_test`;

    // export these for subsequent steps
    process.env.DATABASE_URL_ADMIN = process.env.DATABASE_URL_ADMIN || admin;
    process.env.DATABASE_URL_TEST = process.env.DATABASE_URL_TEST || test;

    // ensure it gets stopped when the process exits
    process.on('exit', async () => {
      try {
        if (embedded && typeof embedded.stop === 'function') await embedded.stop();
      } catch (e) {
        /* noop */
      }
    });

    console.log('[e2e] started embedded Postgres for tests at', test);
    return embedded;
  } catch (err) {
    // No embedded package installed or startup failed; user will need Docker or remote DB
    console.log('[e2e] embedded-postgres unavailable or failed to start:', String(err));
    return null;
  }
}

async function main() {
  const apiRoot = join(__dirname, '..');

  // Attempt embedded Postgres when no external DB configured
  await maybeStartEmbeddedPostgres();

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
