#!/usr/bin/env npx ts-node
/**
 * Valida precios desde el catálogo local de /steam/api/items.
 * Uso:
 *   npx ts-node --transpile-only scripts/pricing/validate-items-catalog-pricing.ts
 *   npx ts-node --transpile-only scripts/pricing/validate-items-catalog-pricing.ts --refresh
 */
import dotenv from "dotenv";
dotenv.config();

import {
  BotPriceLookupService,
  MarketHashNameNormalizer,
  SteamWebApiItemsCatalogClient,
  SteamWebApiItemsCatalogStore,
} from "../../src/modules/pricing";

const TEST_CASES: Array<{ name: string; paintIndex?: number }> = [
  { name: "★ M9 Bayonet | Doppler (Factory New) | Black Pearl", paintIndex: 417 },
  { name: "★ M9 Bayonet | Doppler (Factory New) | Phase 1", paintIndex: 418 },
  { name: "★ M9 Bayonet | Doppler (Factory New) | Phase 2", paintIndex: 419 },
  { name: "★ M9 Bayonet | Doppler (Factory New) | Phase 3", paintIndex: 420 },
  { name: "★ M9 Bayonet | Doppler (Factory New) | Phase 4", paintIndex: 421 },
  { name: "★ M9 Bayonet | Doppler (Factory New) | Ruby", paintIndex: 415 },
  { name: "★ M9 Bayonet | Doppler (Factory New) | Sapphire", paintIndex: 416 },
  { name: "AK-47 | Redline (Field-Tested)" },
  { name: "AWP | Dragon Lore (Factory New)" },
  { name: "M4A4 | Howl (Factory New)" },
  { name: "★ Karambit | Fade (Factory New)" },
];

async function main() {
  const shouldRefresh = process.argv.includes("--refresh");
  const store = new SteamWebApiItemsCatalogStore();

  if (shouldRefresh) {
    const client = new SteamWebApiItemsCatalogClient();
    const result = await client.fetchCatalog({ forceRefresh: true });
    if (!result.snapshot) {
      console.error("No se pudo descargar catálogo:", result.errors.join("; "));
      process.exitCode = 1;
      return;
    }
    await store.writeCatalog(result.snapshot);
    console.log(
      `Catálogo actualizado: ${result.snapshot.itemCount} items, ${result.snapshot.pageCount} páginas.`,
    );
    if (result.errors.length) {
      console.warn("Warnings:", result.errors.join("; "));
    }
  }

  const index = await store.getIndex();
  if (!index) {
    console.warn(
      "No existe catálogo local. Ejecutá primero con --refresh o usá el botón admin 'Precios actualizados'.",
    );
    return;
  }

  const lookup = new BotPriceLookupService();
  const normalizer = new MarketHashNameNormalizer();

  console.log(`Catálogo local: ${index.itemCount} items, fetchedAt=${index.fetchedAt}`);
  for (const testCase of TEST_CASES) {
    const pricingName = normalizer.buildPricingMarketHashName({
      marketHashName: testCase.name,
      paintIndex: testCase.paintIndex,
    });
    const result = lookup.resolveFromItemsCatalog(
      pricingName,
      index,
      testCase.paintIndex,
    );

    console.log("---");
    console.log("Item:", testCase.name);
    console.log("  pricing:", pricingName);
    console.log("  source:", result.source);
    console.log("  lookup:", result.lookupKey);
    console.log("  variant:", result.variantKey ?? "—");
    console.log("  price:", result.price != null ? `$${result.price}` : "NONE");
    if (result.classification.warnings.length) {
      console.log("  warnings:", result.classification.warnings.join("; "));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
