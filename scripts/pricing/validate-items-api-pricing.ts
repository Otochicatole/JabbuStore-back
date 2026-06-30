#!/usr/bin/env npx ts-node
/**
 * Valida pricing de bots vía SteamWebAPI Items API.
 * Uso: npx ts-node scripts/pricing/validate-items-api-pricing.ts
 */
import dotenv from "dotenv";
dotenv.config();

import {
  BotPriceLookupService,
  MarketHashNameNormalizer,
  SteamWebApiItemsPricesClient,
} from "../../src/modules/pricing";

const DOPPLER_BASE = "★ M9 Bayonet | Doppler (Factory New)";

const TEST_CASES: Array<{
  name: string;
  paintIndex?: number;
  expectedVariant?: string;
}> = [
  { name: `${DOPPLER_BASE} | Black Pearl`, paintIndex: 417, expectedVariant: "Black Pearl" },
  { name: `${DOPPLER_BASE} | Phase 1`, paintIndex: 418, expectedVariant: "Phase 1" },
  { name: `${DOPPLER_BASE} | Phase 2`, paintIndex: 419, expectedVariant: "Phase 2" },
  { name: `${DOPPLER_BASE} | Phase 3`, paintIndex: 420, expectedVariant: "Phase 3" },
  { name: `${DOPPLER_BASE} | Phase 4`, paintIndex: 421, expectedVariant: "Phase 4" },
  { name: `${DOPPLER_BASE} | Ruby`, paintIndex: 415, expectedVariant: "Ruby" },
  { name: `${DOPPLER_BASE} | Sapphire`, paintIndex: 416, expectedVariant: "Sapphire" },
  { name: "AK-47 | Redline (Field-Tested)" },
  { name: "StatTrak™ AK-47 | Redline (Field-Tested)" },
  { name: "Revolution Case" },
];

async function main() {
  const client = new SteamWebApiItemsPricesClient();
  const lookup = new BotPriceLookupService();
  const normalizer = new MarketHashNameNormalizer();

  for (const testCase of TEST_CASES) {
    const pricingName = normalizer.buildPricingMarketHashName({
      marketHashName: testCase.name,
      paintIndex: testCase.paintIndex,
    });
    const { baseName } = normalizer.splitDopplerPhase(pricingName);
    const apiName = baseName || pricingName;
    const response = await client.fetchItemDetails(apiName);
    const result = lookup.resolveFromItemsApi(
      pricingName,
      response.item,
      testCase.paintIndex,
    );

    console.log("---");
    console.log("Item:", testCase.name);
    console.log("  API base:", apiName);
    console.log("  expected variant:", testCase.expectedVariant ?? "—");
    console.log("  status:", response.status, response.ok ? "ok" : response.error ?? "no price");
    console.log("  source:", result.source);
    console.log("  variant:", result.variantName ?? "—");
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
