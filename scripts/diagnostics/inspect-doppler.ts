import { storeAccounts } from '../../src/storeAccounts';

async function main() {
  const appId = 730;
  const contextId = 2;
  const steamId = storeAccounts[0]; // test with first bot

  const steamUrl = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?l=english&count=2000`;
  console.log(`Fetching ${steamUrl}...`);
  
  const response = await fetch(steamUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://steamcommunity.com',
    },
  });

  const data = await response.json() as any;
  if (!data || !data.assets || !data.descriptions) {
    console.log("No data found.");
    return;
  }

  // Find a Doppler description
  const dopplerDesc = data.descriptions.find((d: any) => d.market_hash_name && d.market_hash_name.includes('Doppler'));
  if (!dopplerDesc) {
    console.log("No Dopplers found.");
    return;
  }

  // Find corresponding asset
  const asset = data.assets.find((a: any) => a.classid === dopplerDesc.classid);
  
  if (asset) {
    console.log("=== RAW DOPPLER ASSET PROPERTIES ===");
    console.log(JSON.stringify(asset, null, 2));

    if (data.asset_properties) {
        // Asset properties are usually stored outside in the root `asset_properties` array or object
        const props = data.asset_properties.find((ap: any) => ap.assetid === asset.assetid);
        if (props) {
            console.log("\n=== ASSET PROPERTIES ARRAY ===");
            console.log(JSON.stringify(props, null, 2));
        } else {
            console.log("No asset_properties found for this assetid.");
        }
    }
  }
}

main();
