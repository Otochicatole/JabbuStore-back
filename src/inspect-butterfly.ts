import { storeAccounts } from './storeAccounts';

async function main() {
  const appId = 730;
  const contextId = 2;
  
  for (const steamId of storeAccounts) {
    const steamUrl = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?l=english&count=2000`;
    console.log(`Fetching ${steamUrl}...`);
    
    try {
        const response = await fetch(steamUrl, {
            headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://steamcommunity.com',
            },
        });

        const data = await response.json() as any;
        if (!data || !data.assets || !data.descriptions) continue;

        // Find Butterfly Dopplers
        const butterflyDopplers = data.descriptions.filter((d: any) => d.market_hash_name && d.market_hash_name.includes('Butterfly Knife | Doppler'));
        
        for (const desc of butterflyDopplers) {
            console.log(`Found: ${desc.market_hash_name}`);
            const asset = data.assets.find((a: any) => a.classid === desc.classid);
            if (asset && data.asset_properties) {
                const props = data.asset_properties.find((ap: any) => ap.assetid === asset.assetid);
                if (props) {
                    console.log(JSON.stringify(props, null, 2));
                }
            }
        }
    } catch (err) {
        console.error(err);
    }
  }
}

main();
