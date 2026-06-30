import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import { resolveDatabaseUrl } from './databaseUrl';

dotenv.config();

const connectionString = resolveDatabaseUrl();

function createPrismaClient() {
  if (connectionString.startsWith('file:')) {
    const adapter = new PrismaBetterSqlite3({ url: connectionString });
    return new PrismaClient({ adapter });
  }

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as typeof globalThis & {
  __jabbuPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.__jabbuPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__jabbuPrisma = prisma;
}
