import { config } from '../../src/shared/config';

async function main() {
  const apiKey = config.steamwebapiApiKey;
  const itemName = 'AK-47 | Redline (Field-Tested)';
  const encodedName = encodeURIComponent(itemName)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");

  // We wait before starting to make sure we don't hit 429
  console.log('Sleeping 35s first to clear rate limits...');
  await new Promise((resolve) => setTimeout(resolve, 35000));

  const url = `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}&limit=100`;
  console.log(`Querying "${itemName}" with limit=100...`);
  console.log(`URL: ${url}`);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`Failed with status: ${res.status}`);
      const text = await res.text();
      console.log(`Response body:`, text);
      return;
    }

    const body = await res.json() as any;
    const assets = Array.isArray(body) ? body : body?.data || [];
    console.log(`Results count: ${assets.length}`);

    const sourcesCount: Record<string, number> = {};
    for (const asset of assets) {
      sourcesCount[asset.source] = (sourcesCount[asset.source] || 0) + 1;
    }
    console.log('Sources count:', sourcesCount);

    const firstFiveSources = assets.slice(0, 5).map((a: any) => ({
      source: a.source,
      price: a.price,
      float: a.float,
    }));
    console.log('First 5 assets:', firstFiveSources);

  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

main().catch(console.error);
