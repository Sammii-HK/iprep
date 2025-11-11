import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    errorFormat: 'pretty',
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Lazy connect - only connect when first query is made (reduces CPU on startup)
// Prisma will auto-connect on first query, so we don't need to call $connect() explicitly

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
