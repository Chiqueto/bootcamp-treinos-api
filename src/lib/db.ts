import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "./env.js";

export function resolveDatabaseUrl(params: {
  nodeEnv: string;
  databaseUrl: string;
  testDatabaseUrl?: string;
}): string {
  if (params.nodeEnv === "test") {
    const testUrl = params.testDatabaseUrl;

    if (!testUrl || testUrl.trim() === "") {
      throw new Error(
        "TEST_DATABASE_URL está ausente. Os testes de integração exigem TEST_DATABASE_URL configurada para conexão a um banco de teste dedicado.",
      );
    }

    if (testUrl === params.databaseUrl) {
      throw new Error(
        "TEST_DATABASE_URL não pode ser idêntica a DATABASE_URL. Os testes de integração devem executar exclusivamente contra um banco de testes separado para proteger os dados da aplicação.",
      );
    }

    return testUrl;
  }

  return params.databaseUrl;
}

export function getDatabaseUrl(): string {
  return resolveDatabaseUrl({
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    testDatabaseUrl: env.TEST_DATABASE_URL,
  });
}

const connectionString = getDatabaseUrl();

const adapter = new PrismaPg({
  connectionString,
});

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
