import { Prisma } from '@prisma/client';

/**
 * Accepts either the root PrismaService or a transaction client, so services can
 * be composed inside a single `$transaction` when the spec requires atomicity
 * (e.g. the PAID gate creating the ticket + invoices together).
 */
export type Db = Prisma.TransactionClient;
