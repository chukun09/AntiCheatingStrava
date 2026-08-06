import { PrismaClient } from '@prisma/client';

// Patch BigInt.prototype.toJSON to prevent Express res.json() serialization crash
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const db = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
