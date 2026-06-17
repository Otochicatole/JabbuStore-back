import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

function resolveDatabaseUrl(raw?: string): string {
  const url = raw ?? process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  if (!url.startsWith("file:")) return url;

  const filePath = url.slice("file:".length);
  if (path.isAbsolute(filePath)) return url;

  return `file:${path.resolve(process.cwd(), filePath)}`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx ts-node --transpile-only prisma/seed.ts",
  },
  datasource: {
    url: resolveDatabaseUrl(process.env["DATABASE_URL"]),
  },
});
