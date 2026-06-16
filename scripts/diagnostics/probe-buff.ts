import { config } from '../../src/shared/config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
      if (assets[0]) {
        console.log(`  Sample item source: ${assets[0].source}, price: ${assets[0].price}, float: ${assets[0].float}`);
      }
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

  // 1. Test source=buff
  await testParam('source=buff', 
    `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}&source=buff`);

  console.log('Sleeping 35s to respect rate limit...');
  await sleep(35000);

  // 2. Test source=buff163
  await testParam('source=buff163', 
    `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}&source=buff163`);

  console.log('Sleeping 35s to respect rate limit...');
  await sleep(35000);

  // 3. Test source=buff_163
  await testParam('source=buff_163', 
    `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}&source=buff_163`);
}

main().catch(console.error);
