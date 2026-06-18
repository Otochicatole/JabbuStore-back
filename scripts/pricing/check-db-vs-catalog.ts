#!/usr/bin/env npx ts-node
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../src/shared/infrastructure/PrismaClient";
import { SteamWebApiMarketPricesClient } from "../../src/modules/pricing/infrastructure/SteamWebApiMarketPricesClient";
import { BotPriceLookupService } from "../../src/modules/pricing/application/BotPriceLookupService";

async function main() {
  const client = new SteamWebApiMarketPricesClient();
  const catalog = await client.fetchYoupinCatalog(true);
  const lookup = new BotPriceLookupService();

  const items = await prisma.storeItem.findMany({
    where: { name: { contains: "★" } },
    select: { name: true, price: true },
  });

  let mismatch = 0;
  let fallbackLike = 0;

  for (const item of items) {
    const result = lookup.resolve(item.name, catalog);
    const expected = result.price;
    if (expected == null) {
      if (item.price >= 96 && item.price <= 150) fallbackLike++;
      console.log(`NO API: ${item.name} db=$${item.price}`);
      continue;
    }
    const diff = Math.abs(item.price - expected);
    if (diff > 0.02) {
      mismatch++;
      console.log(`MISMATCH: ${item.name} db=$${item.price} api=$${expected} (${result.source})`);
    }
  }

  console.log(`\nTotal knives/gloves: ${items.length}, mismatches: ${mismatch}, no-api with ~fallback price: ${fallbackLike}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
