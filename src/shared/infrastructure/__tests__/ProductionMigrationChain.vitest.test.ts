import Database from "better-sqlite3";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HOTFIX_MIGRATION = "20260720235900_restore_unmigrated_columns";
const temporaryDirectories: string[] = [];

function migrationSql(name: string): string {
  return readFileSync(
    path.join(process.cwd(), "prisma", "migrations", name, "migration.sql"),
    "utf8",
  );
}

describe("production Prisma migration chain", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores every schema column omitted by historical migrations without losing rows", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jabbu-migration-"));
    temporaryDirectories.push(directory);
    const database = new Database(path.join(directory, "database.db"));
    database.pragma("foreign_keys = ON");

    const migrationsDirectory = path.join(process.cwd(), "prisma", "migrations");
    const migrations = readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name < HOTFIX_MIGRATION)
      .sort();

    for (const migration of migrations) {
      database.exec(migrationSql(migration));
    }

    database
      .prepare(
        'INSERT INTO "User" ("id", "name", "updatedAt") VALUES (?, ?, ?)',
      )
      .run("user-1", "Existing user", new Date().toISOString());
    database
      .prepare(
        'INSERT INTO "AdminSettings" ("id", "updatedAt") VALUES (?, ?)',
      )
      .run("settings-1", new Date().toISOString());
    database
      .prepare(
        'INSERT INTO "Bot" ("id", "name", "steamId", "updatedAt") VALUES (?, ?, ?, ?)',
      )
      .run("bot-1", "Existing bot", "steam-bot-1", new Date().toISOString());
    database
      .prepare(
        'INSERT INTO "Order" ("id", "userId", "type", "totalPrice", "updatedAt") VALUES (?, ?, ?, ?, ?)',
      )
      .run("order-1", "user-1", "BUY", 25, new Date().toISOString());

    database.exec(migrationSql(HOTFIX_MIGRATION));

    const user = database
      .prepare('SELECT "name", "isFake" FROM "User" WHERE "id" = ?')
      .get("user-1") as { name: string; isFake: number };
    expect(user).toEqual({ name: "Existing user", isFake: 0 });

    const settings = database
      .prepare(
        'SELECT "homeStatsActiveUsers", "homeStatsAvailableSkins", "homeStatsTransactions", "homeStatsOnlineSupport" FROM "AdminSettings" WHERE "id" = ?',
      )
      .get("settings-1") as Record<string, string>;
    expect(settings).toEqual({
      homeStatsActiveUsers: "150K+",
      homeStatsAvailableSkins: "45K+",
      homeStatsTransactions: "2.5M+",
      homeStatsOnlineSupport: "24/7",
    });

    const order = database
      .prepare('SELECT "totalPrice", "botId" FROM "Order" WHERE "id" = ?')
      .get("order-1") as { totalPrice: number; botId: string | null };
    expect(order).toEqual({ totalPrice: 25, botId: null });

    database
      .prepare('UPDATE "Order" SET "botId" = ? WHERE "id" = ?')
      .run("bot-1", "order-1");
    database.prepare('DELETE FROM "Bot" WHERE "id" = ?').run("bot-1");
    expect(
      database
        .prepare('SELECT "botId" FROM "Order" WHERE "id" = ?')
        .get("order-1"),
    ).toEqual({ botId: null });

    database.close();
  });
});
