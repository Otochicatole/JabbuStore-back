import { config } from '../../src/shared/config';

async function testParam(description: string, url: string) {
  console.log(`\nTesting: ${description}`);
  console.log(`URL: ${url}`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  Failed with status: ${res.status}`);
      return;
    }
    const body = await res.json() as any;
    const assets = Array.isArray(body) ? body : body?.data || [];
    console.log(`  Results count: ${assets.length}`);
    if (assets.length > 0) {
      const sources = new Set(assets.map((a: any) => a.source));
      console.log(`  Unique sources:`, Array.from(sources));
      console.log(`  Sample item source: ${assets[0].source}, price: ${assets[0].price}, float: ${assets[0].float}`);
    }
  } catch (e: any) {
    console.log(`  Error: ${e.message}`);
  }
}

async function main() {
  const apiKey = config.steamwebapiApiKey;
  const itemName = 'AK-47 | Redline (Field-Tested)';
  const encodedName = encodeURIComponent(itemName)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");

  // 1. Default (no limit/source parameters)
  await testParam('Default (Limit 10 by default?)', 
    `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}`);

  // 2. test with limit=100
  await testParam('limit=100', 
    `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}&limit=100`);

  // 3. test with limit=1000
  await testParam('limit=1000', 
    `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}&limit=1000`);

  // 4. test with source=buff
  await testParam('source=buff', 
    `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}&source=buff`);

  // 5. test with source=youpin
  await testParam('source=youpin', 
    `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}&source=youpin`);

  // 6. test with origin=buff
  await testParam('origin=buff', 
    `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}&origin=buff`);
}

main().catch(console.error);
