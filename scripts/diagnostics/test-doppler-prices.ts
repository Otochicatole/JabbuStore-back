import 'dotenv/config';

async function main() {
  const apiKey = process.env.STEAMWEBAPI_API_KEY;
  console.log(`Querying Buff prices for "★ Karambit | Doppler (Factory New)" from SteamWebAPI...`);

  if (!apiKey || apiKey === 'YOUR_STEAMWEBAPI_KEY') {
    console.error("ERROR: STEAMWEBAPI_API_KEY no está configurado en .env");
    return;
  }

  try {
    const response = await fetch(`https://www.steamwebapi.com/market/buff/prices?key=${apiKey}`);

    if (!response.ok) {
      console.error(`API returned error status: ${response.status}`);
      return;
    }

    const responseData = (await response.json()) as any[];
    const itemData = responseData.find(item => item.market_hash_name === "★ Karambit | Doppler (Factory New)");

    if (itemData) {
      console.log('\n=== STEAMWEBAPI DATA FOR KARAMBIT DOPPLER ===');
      console.log(`Base Price: $${itemData.price || 'N/A'}`);
      console.log(`Quantity: ${itemData.quantity || 'N/A'}`);
      
      if (itemData.variants) {
        console.log('\nVariants detected in response:');
        for (const [vName, vData] of Object.entries(itemData.variants)) {
          const vPrice = (vData as any).price || 'N/A';
          const vQty = (vData as any).quantity || 0;
          console.log(`  - ${vName}: $${vPrice} USD (Qty: ${vQty})`);
        }
      } else {
        console.log('No variants detected in response.');
      }
    } else {
      console.log('Item not found in response.');
    }
  } catch (error) {
    console.error('Error fetching prices:', error);
  }
}

main();
