import 'dotenv/config';

async function test() {
  const apiKey = process.env.STEAMWEBAPI_API_KEY;
  if (!apiKey) return;
  const item = "★ Karambit | Doppler (Factory New)";
  const encodedName = encodeURIComponent(item).replace(/\(/g, '%28').replace(/\)/g, '%29');
  const url = `https://www.steamwebapi.com/steam/api/float/assets?key=${apiKey}&appid=730&market_hash_name=${encodedName}`;
  const response = await fetch(url);
  const data = await response.json();
  console.log('Raw Response:', JSON.stringify(data, null, 2));
}

test();
