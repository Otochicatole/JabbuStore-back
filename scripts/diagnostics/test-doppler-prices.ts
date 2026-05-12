import 'dotenv/config';
import { PriceEnrichmentService } from '../../src/shared/infrastructure/PriceEnrichmentService';

async function main() {
  const apiKey = process.env.CS2_SH_API_KEY || "demo_XtEHDOxUhPjBmvYxesvNbqrPMfkiKNMC";
  console.log(`Querying prices for "★ Karambit | Doppler (Factory New)" with API key...`);

  try {
    const response = await fetch('https://api.cs2.sh/v1/prices/latest', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: ["★ Karambit | Doppler (Factory New)"] }),
    });

    if (!response.ok) {
      console.error(`API returned error status: ${response.status}`);
      return;
    }

    const responseData = (await response.json()) as any;
    const itemData = responseData.items["★ Karambit | Doppler (Factory New)"];

    if (itemData) {
      console.log('\n=== CS2.SH DATA FOR KARAMBIT DOPPLER ===');
      console.log(`Average Ask: $${itemData.csfloat?.ask || itemData.buff?.ask || 'N/A'}`);
      
      if (itemData.variants) {
        console.log('\nVariants detected:');
        for (const [vName, vData] of Object.entries(itemData.variants)) {
          const vPrice = (vData as any).csfloat?.ask || (vData as any).buff?.ask || 'N/A';
          console.log(`  - ${vName}: $${vPrice} USD`);
        }
      } else {
        console.log('No variants in cs2.sh response.');
      }
    } else {
      console.log('Item not found in response.');
    }
  } catch (error) {
    console.error('Error fetching prices:', error);
  }
}

main();
