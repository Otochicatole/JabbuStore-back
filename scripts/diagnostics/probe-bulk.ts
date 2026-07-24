import 'dotenv/config';
import { AdminSecureConfigService } from '../../src/modules/marketplace/application/AdminSecureConfigService';

async function main() {
  const apiKey = await AdminSecureConfigService.getSecretValue('STEAMWEBAPI_API_KEY');
  if (!apiKey) return;
  
  const url = `https://www.steamwebapi.com/market/youpin/prices?key=${apiKey}`;
  const response = await fetch(url);
  if (response.ok) {
    const data = await response.json() as any[];
    const doppler = data.find((item: any) => 
      item.market_hash_name && 
      item.market_hash_name.includes('Doppler') && 
      item.variants && 
      item.variants.length > 0
    );
    if (doppler) {
      console.log('Doppler with variants:', JSON.stringify(doppler, null, 2));
    } else {
      console.log('No doppler with variants found.');
      const anyDoppler = data.find((item: any) => item.market_hash_name && item.market_hash_name.includes('Doppler'));
      console.log('Any Doppler:', JSON.stringify(anyDoppler, null, 2));
    }
  }
}

main().catch(console.error);
