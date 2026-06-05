import 'dotenv/config';

async function test() {
  const apiKey = process.env.STEAMWEBAPI_API_KEY;
  if (!apiKey) return;

  try {
    const r = await fetch(`https://www.steamwebapi.com/market/buff/prices?key=${apiKey}`);
    console.log('Status:', r.status);
    const data = await r.json();
    console.log('Error details:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}
test();