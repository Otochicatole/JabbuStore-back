import { describe, expect, it } from "vitest";
import { resolvePaintIndexForPhase } from "../../../market/application/floatSyncHelpers";
import { PAINT_INDEX_TO_PHASE } from "../../domain/constants";
import { BotPriceLookupService } from "../BotPriceLookupService";
import { MarketHashNameNormalizer } from "../MarketHashNameNormalizer";
import { SteamWebApiItemsCatalogStore } from "../../infrastructure/SteamWebApiItemsCatalogStore";

describe("Glock-18 Gamma Doppler phases", () => {
  const expected = [
    [1119, "emerald", "Emerald"],
    [1120, "phase1", "Phase 1"],
    [1121, "phase2", "Phase 2"],
    [1122, "phase3", "Phase 3"],
    [1123, "phase4", "Phase 4"],
  ] as const;

  it("usa los paint indexes presentes en items-catalog.json", () => {
    const normalizer = new MarketHashNameNormalizer();
    for (const [paintIndex, phaseKey, phaseLabel] of expected) {
      expect(PAINT_INDEX_TO_PHASE[paintIndex]).toBe(phaseKey);
      expect(
        normalizer.detectDopplerPhase({
          marketHashName: "Glock-18 | Gamma Doppler (Factory New)",
          paintIndex,
        }),
      ).toBe(phaseKey);
      expect(
        resolvePaintIndexForPhase(
          phaseLabel,
          "Glock-18 | Gamma Doppler (Factory New)",
        ),
      ).toBe(paintIndex);
    }
  });

  it("resuelve el precio específico de Phase 1 desde variants[] sin confundirlo con el paintindex padre (569)", () => {
    const store = new SteamWebApiItemsCatalogStore();
    const index = store.buildIndex({
      fetchedAt: "2026-11-23T00:00:00.000Z",
      currency: "USD",
      market: "youpin",
      sourceUrl: "test://items",
      pageCount: 1,
      itemCount: 1,
      errors: [],
      items: [
        {
          markethashname: "★ Karambit | Gamma Doppler (Factory New)",
          pricereal: 1143.67,
          paintindex: 569,
          variants: [
            { phase: "Emerald", paintindex: 568, pricereal: 5280.33 },
            { phase: "Phase 1", paintindex: 569, pricereal: 1417.87 },
            { phase: "Phase 4", paintindex: 572, pricereal: 1143.67 },
          ],
        },
      ],
    });

    const lookup = new BotPriceLookupService();
    const phase1Result = lookup.resolveFromItemsCatalog(
      "★ Karambit | Gamma Doppler (Factory New) | Phase 1",
      index,
      569,
    );
    expect(phase1Result.price).toBe(1417.87);
    expect(phase1Result.source).toBe("steamwebapi_items_catalog_variant");
  });
});
