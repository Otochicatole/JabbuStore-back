import { describe, expect, it } from "vitest";
import { MarketAssetsPriorityQueueBuilder } from "../MarketAssetsPriorityQueue";
import { catalogReader } from "./marketAssetsTestHelpers";

const items = [
  {
    markethashname: "AK-47 | Redline (Field-Tested)",
    itemgroup: "rifle",
    pricereal: 100,
  },
  {
    // Mismo listing: debe prevalecer el precio de prioridad más alto.
    markethashname: "AK-47 | Redline (Field-Tested)",
    itemgroup: "rifle",
    pricemix: 120,
  },
  {
    markethashname: "AWP | Asiimov (Field-Tested)",
    itemtype: "sniper rifle",
    pricelatest: 110,
  },
  {
    // "Case" forma parte del acabado; no es un contenedor.
    markethashname: "AK-47 | Case Hardened (Field-Tested)",
    itemgroup: "rifle",
    pricereal: 130,
  },
  {
    markethashname: "★ Karambit | Doppler (Factory New)",
    itemgroup: "knife",
    wear: "fn",
    variants: [
      { phase: "Ruby", paintindex: 415, pricereal: 2_000 },
      { phase: "Phase 1", paintindex: 418, pricemix: 1_500 },
      // Sin precio exacto de variante: no debe heredar el precio del padre.
      { phase: "Phase 2", paintindex: 419 },
      // Sin paint index no se puede validar contra float/assets.
      { phase: "Sapphire", pricereal: 3_000 },
    ],
    pricereal: 9_999,
  },
  {
    markethashname: "Sticker | Ignored",
    itemgroup: "sticker",
    pricereal: 50_000,
  },
  {
    markethashname: "Dreams & Nightmares Case",
    itemtype: "case",
    pricereal: 40_000,
  },
  {
    markethashname: "M4A4 | No Price (Minimal Wear)",
    itemgroup: "rifle",
  },
];

describe("MarketAssetsPriorityQueueBuilder", () => {
  it("filtra consumibles, expande variantes, deduplica y ordena por precio", async () => {
    const queue = await new MarketAssetsPriorityQueueBuilder(
      catalogReader(items),
    ).build();

    expect(
      queue.candidates.map(({ marketHashName, priorityPrice }) => ({
        marketHashName,
        priorityPrice,
      })),
    ).toEqual([
      {
        marketHashName: "★ Karambit | Doppler | Ruby (Factory New)",
        priorityPrice: 2_000,
      },
      {
        marketHashName: "★ Karambit | Doppler | Phase 1 (Factory New)",
        priorityPrice: 1_500,
      },
      {
        marketHashName: "AK-47 | Case Hardened (Field-Tested)",
        priorityPrice: 130,
      },
      {
        marketHashName: "AK-47 | Redline (Field-Tested)",
        priorityPrice: 120,
      },
      {
        marketHashName: "AWP | Asiimov (Field-Tested)",
        priorityPrice: 110,
      },
    ]);
    expect(queue.candidates[0]).toMatchObject({
      queryMarketHashName: "★ Karambit | Doppler (Factory New)",
      phase: "Ruby",
      paintIndex: 415,
      wear: "fn",
    });
  });

  it("calcula la versión desde el contenido real, no desde fetchedAt", async () => {
    const oldTimestamp = await new MarketAssetsPriorityQueueBuilder(
      catalogReader(items, { fetchedAt: "2025-01-01T00:00:00.000Z" }),
    ).build();
    const newTimestamp = await new MarketAssetsPriorityQueueBuilder(
      catalogReader(items, { fetchedAt: "2026-07-20T00:00:00.000Z" }),
    ).build();
    const changedPrice = await new MarketAssetsPriorityQueueBuilder(
      catalogReader(
        items.map((item) =>
          item.markethashname === "AWP | Asiimov (Field-Tested)"
            ? { ...item, pricelatest: 111 }
            : item,
        ),
      ),
    ).build();

    expect(oldTimestamp.version).toBe(newTimestamp.version);
    expect(changedPrice.version).not.toBe(oldTimestamp.version);
    expect(oldTimestamp.version).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rechaza snapshots parciales para no priorizar un catálogo truncado", async () => {
    const builder = new MarketAssetsPriorityQueueBuilder(
      catalogReader(items, { errors: ["page 2 failed"] }),
    );

    await expect(builder.build()).rejects.toThrow(
      "items-catalog.json fue generado con errores",
    );
    await expect(builder.build()).rejects.toMatchObject({
      kind: "catalog_invalid",
    });
  });

  it("tipa como inválido un items-catalog.json ilegible", async () => {
    const builder = new MarketAssetsPriorityQueueBuilder({
      readCatalog: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });

    await expect(builder.build()).rejects.toMatchObject({
      name: "MarketAssetsPriorityQueueError",
      kind: "catalog_invalid",
    });
  });
});
