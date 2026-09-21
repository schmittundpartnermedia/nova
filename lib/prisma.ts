import { PrismaClient } from "@prisma/client";

const PRISMA_SCHEMA_STAMP = "research-search-v1";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaStamp?: string;
};

function createPrisma() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getPrisma() {
  if (globalForPrisma.prisma && globalForPrisma.prismaStamp === PRISMA_SCHEMA_STAMP) {
    return globalForPrisma.prisma;
  }
  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  }
  const client = createPrisma();
  globalForPrisma.prisma = client;
  globalForPrisma.prismaStamp = PRISMA_SCHEMA_STAMP;
  return client;
}

export const prisma = getPrisma();
