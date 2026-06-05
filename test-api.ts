import 'dotenv/config';

async function test() {
  const apiKey = process.env.STEAMWEBAPI_API_KEY;
  console.log('API Key:', apiKey ? 'FOUND' : 'MISSING');
  if (!apiKey) return;

  try {
    const r = await fetch(`https://www.steamwebapi.com/market/buff/prices?key=${apiKey}`);
    console.log('Status:', r.status);
    const data = (await r.json()) as any;
    
    if (Array.isArray(data)) {
      console.log('Is Array. Total items:', data.length);
      console.log('First item:', JSON.stringify(data[0], null, 2));
    } else {
      console.log('Is NOT Array. Keys:', Object.keys(data));
      const firstKey = Object.keys(data)[0];
      if (firstKey) {
        console.log(`First key (${firstKey}):`, JSON.stringify(data[firstKey], null, 2));
      }
    }
  } catch (e) {
    console.error('Fetch error:', e);
  }
}

test();