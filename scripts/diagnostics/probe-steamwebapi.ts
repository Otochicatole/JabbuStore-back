import 'dotenv/config';

async function testAll() {
  const apiKey = process.env.STEAMWEBAPI_API_KEY;
  console.log("Using SteamWebAPI Key:", apiKey ? `${apiKey.substring(0, 5)}...` : "UNDEFINED");
  
  if (!apiKey || apiKey === 'YOUR_STEAMWEBAPI_KEY') {
    console.error("ERROR: STEAMWEBAPI_API_KEY no está configurado en .env");
    return;
  }

  try {
    console.log("Probing Buff prices endpoint...");
    const res = await fetch(`https://www.steamwebapi.com/market/buff/prices?key=${apiKey}`);
    console.log("GET /market/buff/prices status:", res.status);
    
    if (!res.ok) {
      console.error(`Error: Response status ${res.status}`);
      return;
    }

    const data = await res.json() as any[];
    console.log("Total Buff items:", data.length);
    console.log("First 3 items:", JSON.stringify(data.slice(0, 3), null, 2));

    // Buscar si hay algún Doppler para ver variantes
    const doppler = data.find(item => item.market_hash_name && item.market_hash_name.includes("Doppler") && item.variants);
    if (doppler) {
      console.log("\nFound Doppler item with variants:");
      console.log(JSON.stringify(doppler, null, 2));
    } else {
      console.log("\nNo Doppler item with variants found in the first slice of items.");
    }
  } catch (err) {
    console.error("GET failed:", err);
  }
}

testAll();
