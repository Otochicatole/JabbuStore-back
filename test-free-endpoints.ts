import 'dotenv/config';

async function tryEndpoint(url: string) {
  try {
    const r = await fetch(url);
    console.log(`URL: ${url} -> Status: ${r.status}`);
    if (r.status === 200) {
      const data = await r.json() as any;
      if (Array.isArray(data)) {
        console.log(`  SUCCESS! Array with ${data.length} items. First:`, JSON.stringify(data[0], null, 2));
        return true;
      } else {
        console.log(`  SUCCESS! Object keys: ${Object.keys(data).slice(0, 5)}. First item sample:`, JSON.stringify(data[Object.keys(data)[0]], null, 2));
        return true;
      }
    } else {
      const txt = await r.text();
      console.log(`  FAIL: ${txt.substring(0, 150)}`);
    }
  } catch (e: any) {
    console.log(`  ERROR: ${e.message}`);
  }
  return false;
}

async function main() {
  const apiKey = process.env.STEAMWEBAPI_API_KEY;
  if (!apiKey) {
    console.error('No API Key found');
    return;
  }

  const endpoints = [
    `https://www.steamwebapi.com/steam/api/items?key=${apiKey}&appid=730`,
    `https://www.steamwebapi.com/steam/api/prices?key=${apiKey}&appid=730`,
    `https://www.steamwebapi.com/market/prices?key=${apiKey}&appid=730`,
  ];

  for (const url of endpoints) {
    const ok = await tryEndpoint(url);
    if (ok) {
      console.log('--- FOUND WORKING ENDPOINT ---');
    }
    console.log('\n');
  }
}


main();