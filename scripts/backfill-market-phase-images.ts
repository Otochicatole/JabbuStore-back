import "dotenv/config";
import { prisma } from "../src/shared/infrastructure/PrismaClient";
import { MarketHashNameNormalizer } from "../src/modules/pricing/application/MarketHashNameNormalizer";
import { SteamWebApiItemsCatalogStore } from "../src/modules/pricing/infrastructure/SteamWebApiItemsCatalogStore";
import { resolveVariantImageUrl } from "../src/modules/market/application/AssetImageResolver";

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

async function main() {
  const catalogStore = new SteamWebApiItemsCatalogStore();
  const index = await catalogStore.getIndex();
  if (!index) {
    throw new Error(
      "No existe el catálogo local de SteamWebAPI. Descargalo antes de ejecutar el backfill.",
    );
  }

  const normalizer = new MarketHashNameNormalizer();
  const listings = await prisma.marketListing.findMany({
    where: { name: { contains: "Doppler" } },
    select: { id: true, name: true, iconUrl: true },
  });

  let updated = 0;
  let unresolved = 0;

  for (const listing of listings) {
    const wear = normalizer.extractWear(listing.name);
    const withoutWear = normalizer.stripWear(listing.name);
    const { baseName, phase } = normalizer.splitDopplerPhase(withoutWear);
    if (!phase) {
      unresolved++;
      continue;
    }

    const lookupName = wear ? `${baseName} (${wear})` : baseName;
    const candidates = index.rowsByName.get(normalizeKey(lookupName)) ?? [];
    const matchingRow = candidates.find((row) => {
      const rowName = row.markethashname ?? row.market_hash_name ?? "";
      return (
        /stattrak/i.test(rowName) === /stattrak/i.test(listing.name) &&
        /souvenir/i.test(rowName) === /souvenir/i.test(listing.name)
      );
    });
    const imageUrl = resolveVariantImageUrl(matchingRow, null, phase);

    if (!imageUrl) {
      unresolved++;
      continue;
    }
    if (imageUrl === listing.iconUrl) continue;

    await prisma.marketListing.update({
      where: { id: listing.id },
      data: { iconUrl: imageUrl },
    });
    updated++;
  }

  console.log(
    `[Market Phase Images] ${updated} listings actualizados; ${unresolved} sin variante resoluble.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[Market Phase Images] Error:", error);
    process.exit(1);
  });
