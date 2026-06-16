import { prisma } from '../../src/shared/infrastructure/PrismaClient';
import { config } from '../../src/shared/config';

async function main() {
  console.log('--- PROBING API SOURCES ---');
  const apiKey = config.steamwebapiApiKey;
  if (!apiKey) {
    console.error('API key not found!');
    return;
  }

  // Get a few different types of items to probe
  const listings = await prisma.marketListing.findMany({
    take: 10,
    where: {
      OR: [
        { name: { contains: 'AK-47' } },
        { name: { contains: 'Knife' } },
        { name: { contains: 'M4A4' } },
        { name: { contains: 'AWP' } },
        { name: { contains: 'Glove' } },
      ]
    }
  });

  console.log(`Found ${listings.length} listings to probe.`);

  const allSources = new Set<string>();
  const sourceSamples: Record<string, any> = {};

  for (const listing of listings) {
    const encodedName = encodeURIComponent(listing.name)
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");

    const url = `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}`;
    console.log(`Querying "${listing.name}"...`);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Error response for ${listing.name}: ${res.status}`);
        continue;
      }

      const body = await res.json() as any;
      const assets = Array.isArray(body) ? body : body?.data || [];

      console.log(`  Fetched ${assets.length} raw assets.`);
      for (const asset of assets) {
        if (asset.source) {
          allSources.add(asset.source);
          if (!sourceSamples[asset.source]) {
            sourceSamples[asset.source] = {
              name: listing.name,
              price: asset.price,
              float: asset.float,
              marketid: asset.marketid,
            };
          }
        }
      }
    } catch (e: any) {
      console.error(`  Failed to query ${listing.name}:`, e.message);
    }

    // Delay to respect rate limit
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  console.log('\n--- PROBE SUMMARY ---');
  console.log('All unique sources found:', Array.from(allSources));
  console.log('Sample data per source:');
  console.log(JSON.stringify(sourceSamples, null, 2));
}

main().catch(console.error);
