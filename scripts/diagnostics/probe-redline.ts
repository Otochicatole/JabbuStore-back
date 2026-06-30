import { config } from '../../src/shared/config';

async function main() {
  const apiKey = config.steamwebapiApiKey;
  const itemName = 'AK-47 | Redline (Field-Tested)';
  const encodedName = encodeURIComponent(itemName)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");

  const url = `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}`;
  console.log(`Querying "${itemName}"...`);

  const res = await fetch(url);
  const body = await res.json() as any;
  const assets = Array.isArray(body) ? body : body?.data || [];

  console.log(`Fetched ${assets.length} assets.`);
  
  // Print unique sources and sample of each
  const sources = new Set(assets.map((a: any) => a.source));
  console.log('Unique sources:', Array.from(sources));

  const sampleBySource: Record<string, any> = {};
  for (const asset of assets) {
    if (!sampleBySource[asset.source]) {
      sampleBySource[asset.source] = asset;
    }
  }

  console.log('Sample assets by source:', JSON.stringify(sampleBySource, null, 2));
}

main().catch(console.error);
