#!/usr/bin/env npx ts-node
/**
 * Valida lookup de precios YouPin para casos mínimos del spec.
 * Uso: npx ts-node scripts/pricing/validate-lookup-cases.ts
 */
import dotenv from "dotenv";
dotenv.config();

import {
  BotPriceLookupService,
  ItemVariantClassifier,
  MarketHashNameNormalizer,
  SteamWebApiMarketPricesClient,
} from "../../src/modules/pricing";

const TEST_CASES = [
  "AK-47 | Redline (Field-Tested)",
  "StatTrak™ AK-47 | Redline (Field-Tested)",
  "Souvenir AK-47 | Safari Mesh (Field-Tested)",
  "AWP | Dragon Lore (Factory New)",
  "M4A1-S | Printstream (Field-Tested)",
  "StatTrak™ M4A1-S | Printstream (Minimal Wear)",
  "Glock-18 | Gamma Doppler (Factory New) | Phase 1",
  "Glock-18 | Gamma Doppler (Factory New) | Emerald",
  "★ Karambit",
  "★ StatTrak™ Karambit",
  "★ Karambit | Doppler (Factory New) | Phase 1",
  "★ Karambit | Doppler (Factory New) | Ruby",
  "★ Karambit | Doppler (Factory New) | Sapphire",
  "★ Karambit | Doppler (Factory New) | Black Pearl",
  "★ Butterfly Knife | Gamma Doppler (Factory New) | Emerald",
  "★ M9 Bayonet | Marble Fade (Factory New)",
  "★ Karambit | Fade (Factory New)",
  "AK-47 | Case Hardened (Field-Tested)",
  "Five-SeveN | Case Hardened (Minimal Wear)",
  "Sport Gloves | Vice (Field-Tested)",
];

async function main() {
  const client = new SteamWebApiMarketPricesClient();
  const catalog = await client.fetchYoupinCatalog(true);
  const lookup = new BotPriceLookupService();
  const classifier = new ItemVariantClassifier();
  const normalizer = new MarketHashNameNormalizer();

  console.log(`Catálogo cargado: ${catalog.size} filas\n`);

  for (const name of TEST_CASES) {
    const classification = classifier.classify(name);
    const result = lookup.resolve(name, catalog);
    const baseKey = normalizer.baseTemplateKey(classification.normalized);

    console.log("---");
    console.log("Item:", name);
    console.log("  category:", classification.normalized.itemCategory);
    console.log("  wear:", classification.normalized.wear);
    console.log("  variant:", classification.normalized.variantName);
    console.log("  independent:", classification.independentVariantReasons.join("; ") || "—");
    console.log("  metadata:", classification.metadataOnlyReasons.join("; ") || "—");
    console.log("  base template:", baseKey);
    console.log(
      "  price:",
      result.price != null ? `$${result.price}` : "NONE",
      `(${result.source})`,
    );
    if (classification.warnings.length) {
      console.log("  warnings:", classification.warnings.join("; "));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
