import { PrismaClient } from "@prisma/client";
import { config } from "./index";

// Create global Prisma client instance
declare global {
  var __prisma: PrismaClient | undefined;
}

const createPrismaClient = () => {
  // Add pgbouncer=true to connection string if using Supabase
  const databaseUrl = config.database.url;
  const optimizedUrl =
    databaseUrl.includes("supabase") && !databaseUrl.includes("pgbouncer=true")
      ? `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}pgbouncer=true`
      : databaseUrl;

  return new PrismaClient({
    log:
      config.server.nodeEnv === "development"
        ? ["error", "warn"] // Reduce logging to prevent spam
        : ["error"],
    errorFormat: "pretty",
    datasources: {
      db: {
        url: optimizedUrl,
      },
    },
  });
};

// Use global instance in development to prevent multiple connections
export const prisma = globalThis.__prisma ?? createPrismaClient();

if (config.server.nodeEnv === "development") {
  globalThis.__prisma = prisma;
}

// Handle graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
