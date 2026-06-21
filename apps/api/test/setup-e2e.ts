/**
 * Runs before every e2e test file (jest `setupFiles`). Points the app + Prisma
 * at the dedicated test database and keeps the external integrations
 * unconfigured so no test ever reaches the M-Pesa or eTIMS network. Must run
 * before AppModule is imported, which `setupFiles` guarantees.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://omnibite:omnibite@localhost:5432/omnibite_test';
process.env.NODE_ENV = 'test';
process.env.ETIMS_BASE_URL = '';
process.env.MPESA_CONSUMER_KEY = '';
process.env.REDIS_URL = '';
