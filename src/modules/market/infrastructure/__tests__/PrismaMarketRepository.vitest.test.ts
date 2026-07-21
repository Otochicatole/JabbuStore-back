import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { MarketAssetsCatalogSnapshot } from "../../domain/MarketAssetsCatalog";

let databaseDirectory = "";
let prisma: PrismaClient;
let publisher: import("../../application/MarketAssetsCatalogPublisher").MarketAssetsCatalogPublisher;
let repository: import("../PrismaMarketRepository").PrismaMarketRepository;

function createSchema(databasePath: string): void {
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE "MarketListing" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "youpinAsk" REAL,
      "youpinVolume" INTEGER,
      "price" REAL NOT NULL DEFAULT 0.0,
      "iconUrl" TEXT,
      "rarity" TEXT NOT NULL DEFAULT 'common',
      "exterior" TEXT,
      "category" TEXT NOT NULL DEFAULT 'other',
      "isStatTrak" BOOLEAN NOT NULL DEFAULT false,
      "isSouvenir" BOOLEAN NOT NULL DEFAULT false,
      "isPriceManual" BOOLEAN NOT NULL DEFAULT false,
      "floatsSyncedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE UNIQUE INDEX "MarketListing_name_key" ON "MarketListing"("name");
    CREATE INDEX "MarketListing_exterior_floatsSyncedAt_idx"
      ON "MarketListing"("exterior", "floatsSyncedAt");

    CREATE TABLE "floats" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "assetId" TEXT NOT NULL,
      "floatValue" REAL NOT NULL,
      "paintSeed" INTEGER NOT NULL,
      "market" TEXT NOT NULL,
      "price" REAL NOT NULL,
      "inspectLink" TEXT,
      "available" BOOLEAN NOT NULL DEFAULT true,
      "externalId" TEXT,
      "lastSyncAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "resaleItemId" TEXT NOT NULL,
      CONSTRAINT "floats_resaleItemId_fkey"
        FOREIGN KEY ("resaleItemId") REFERENCES "MarketListing" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX "floats_market_assetId_key" ON "floats"("market", "assetId");
  `);
  database.close();
}

function snapshot(): MarketAssetsCatalogSnapshot {
  const common = {
    marketHashName: "",
    floatValue: 0.1,
    paintSeed: 123,
    inspectLink: null,
    iconUrl: "https://example.test/skin.png",
    rarity: "classified",
    exterior: "Factory New",
    category: "rifle",
    isStatTrak: false,
    isSouvenir: false,
  };
  return {
    schemaVersion: 1,
    version: "a".repeat(64),
    fetchedAt: new Date(0).toISOString(),
    source: "youpin",
    sourceUrl: "https://example.test/float/assets?limit=10",
    sort: "newest",
    requestedLimit: 3,
    providerTotal: 3,
    rawAssetCount: 3,
    validAssetCount: 3,
    skippedAssetCount: 0,
    completionReason: "target_reached",
    assets: [
      {
        ...common,
        assetId: "manual-asset",
        externalId: "manual-market-id",
        marketHashName: "AK-47 | Manual (Factory New)",
        listingName: "AK-47 | Manual (Factory New)",
        price: 10,
      },
      {
        ...common,
        assetId: "auto-expensive",
        externalId: "auto-market-id-1",
        marketHashName: "M4A1-S | Atomic (Factory New)",
        listingName: "M4A1-S | Atomic (Factory New)",
        price: 50,
      },
      {
        ...common,
        assetId: "auto-cheap",
        externalId: "auto-market-id-2",
        marketHashName: "M4A1-S | Atomic (Factory New)",
        listingName: "M4A1-S | Atomic (Factory New)",
        price: 30,
      },
    ],
  };
}

describe("PrismaMarketRepository atomic publication", () => {
  beforeAll(async () => {
    databaseDirectory = await mkdtemp(path.join(tmpdir(), "jabbu-market-prisma-"));
    const databasePath = path.join(databaseDirectory, "market.db");
    createSchema(databasePath);
    process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, "/")}`;
    delete (globalThis as typeof globalThis & { __jabbuPrisma?: PrismaClient })
      .__jabbuPrisma;
    vi.resetModules();

    ({ prisma } = await import("../../../../shared/infrastructure/PrismaClient"));
    const { PrismaMarketRepository } = await import("../PrismaMarketRepository");
    const { MarketAssetsCatalogPublisher } = await import(
      "../../application/MarketAssetsCatalogPublisher"
    );
    repository = new PrismaMarketRepository();
    publisher = new MarketAssetsCatalogPublisher(repository);
  });

  beforeEach(async () => {
    await prisma.floatItem.deleteMany();
    await prisma.marketListing.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    delete (globalThis as typeof globalThis & { __jabbuPrisma?: PrismaClient })
      .__jabbuPrisma;
    if (databaseDirectory) {
      await rm(databaseDirectory, { recursive: true, force: true });
    }
  });

  it("preserva manuales, usa el menor precio y mantiene IDs de assets estables", async () => {
    await prisma.marketListing.create({
      data: {
        id: "manual-listing-id",
        name: "AK-47 | Manual (Factory New)",
        provider: "youpin",
        price: 777,
        isPriceManual: true,
      },
    });
    await prisma.marketListing.create({
      data: {
        id: "obsolete-listing-id",
        name: "AWP | Obsolete (Field-Tested)",
        provider: "youpin",
        price: 20,
      },
    });

    await publisher.publish(snapshot());

    const manual = await prisma.marketListing.findUnique({
      where: { name: "AK-47 | Manual (Factory New)" },
      include: { floats: true },
    });
    const automatic = await prisma.marketListing.findUnique({
      where: { name: "M4A1-S | Atomic (Factory New)" },
      include: { floats: { orderBy: { price: "asc" } } },
    });
    expect(manual).toMatchObject({
      id: "manual-listing-id",
      price: 777,
      isPriceManual: true,
    });
    expect(manual?.floats).toHaveLength(1);
    expect(automatic).toMatchObject({ price: 30, youpinAsk: 30 });
    expect(automatic?.floats.map((item) => item.price)).toEqual([30, 50]);
    expect(
      await prisma.marketListing.findUnique({
        where: { name: "AWP | Obsolete (Field-Tested)" },
      }),
    ).toBeNull();

    const firstIds = new Map(
      (await prisma.floatItem.findMany()).map((item) => [item.assetId, item.id]),
    );
    await publisher.publish(snapshot());
    const secondIds = new Map(
      (await prisma.floatItem.findMany()).map((item) => [item.assetId, item.id]),
    );
    expect(secondIds).toEqual(firstIds);

    const currentAutomatic = await prisma.marketListing.findUniqueOrThrow({
      where: { name: "M4A1-S | Atomic (Factory New)" },
    });
    await expect(
      prisma.floatItem.create({
        data: {
          id: "duplicate-provider-asset",
          assetId: "auto-cheap",
          floatValue: 0.2,
          paintSeed: 999,
          market: "YOUPIN",
          price: 1,
          resaleItemId: currentAutomatic.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("acepta catálogo realmente agotado, elimina automáticos y conserva manuales", async () => {
    await prisma.marketListing.create({
      data: {
        id: "manual-empty-id",
        name: "AK-47 | Manual (Factory New)",
        provider: "youpin",
        price: 777,
        isPriceManual: true,
      },
    });
    await publisher.publish(snapshot());

    const emptySnapshot: MarketAssetsCatalogSnapshot = {
      ...snapshot(),
      version: "e".repeat(64),
      requestedLimit: 10_000,
      providerTotal: 0,
      rawAssetCount: 0,
      validAssetCount: 0,
      skippedAssetCount: 0,
      completionReason: "catalog_exhausted",
      assets: [],
    };
    await expect(publisher.publish(emptySnapshot)).resolves.toEqual({
      listings: 0,
      floats: 0,
    });

    expect(
      await prisma.marketListing.findUnique({
        where: { name: "AK-47 | Manual (Factory New)" },
      }),
    ).toMatchObject({ id: "manual-empty-id", price: 777, isPriceManual: true });
    expect(
      await prisma.marketListing.findUnique({
        where: { name: "M4A1-S | Atomic (Factory New)" },
      }),
    ).toBeNull();
    expect(await prisma.floatItem.count()).toBe(0);
  });

  it("revierte por completo si falla cualquier escritura del snapshot", async () => {
    await publisher.publish(snapshot());
    const listingsBefore = await prisma.marketListing.findMany({
      orderBy: { name: "asc" },
    });
    const floatsBefore = await prisma.floatItem.findMany({
      orderBy: { assetId: "asc" },
    });

    await expect(
      repository.replaceAutomaticCatalogWithFloats(
        [
          {
            name: "Broken listing",
            provider: "youpin",
            youpinAsk: 1,
            youpinVolume: 1,
            price: 1,
            iconUrl: "https://example.test/broken.png",
            rarity: "common",
            exterior: null,
            category: "rifle",
            isStatTrak: false,
            isSouvenir: false,
          },
        ],
        new Map([
          [
            "Broken listing",
            [
              {
                assetId: "broken-asset",
                floatValue: 0.1,
                paintSeed: 1,
                market: "YOUPIN" as const,
                price: Number.NaN,
                inspectLink: null,
                available: true,
                externalId: "broken-market-id",
                lastSyncAt: new Date(0),
              },
            ],
          ],
        ]),
      ),
    ).rejects.toThrow();

    expect(
      await prisma.marketListing.findMany({ orderBy: { name: "asc" } }),
    ).toEqual(listingsBefore);
    expect(
      await prisma.floatItem.findMany({ orderBy: { assetId: "asc" } }),
    ).toEqual(floatsBefore);
  });
});
