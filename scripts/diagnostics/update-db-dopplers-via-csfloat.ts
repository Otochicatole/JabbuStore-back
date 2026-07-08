import 'dotenv/config';
import { prisma } from '../../src/shared/infrastructure/PrismaClient';
import { PriceEnrichmentService } from '../../src/shared/infrastructure/PriceEnrichmentService';

interface EnrichedStoreItem {
  assetId: string;
  classId: string;
  name: string;
  type: string;
  price: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log('=== DOPPLER RESOLUTION VIA CSFLOAT API ===');

  const botSteamId = "76561198084181822";
  const appId = 730;
  const contextId = 2;
  const steamUrl = `https://steamcommunity.com/inventory/${botSteamId}/${appId}/${contextId}?l=english&count=2000`;

  console.log(`\n1. Fetching inventory for bot: ${botSteamId}...`);
  try {
    const response = await fetch(steamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://steamcommunity.com',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch inventory from Steam: ${response.statusText} (${response.status})`);
    }

    const data = (await response.json()) as any;
    if (!data || !data.assets || !data.descriptions) {
      console.log('No assets or descriptions found in Steam response.');
      return;
    }

    console.log(`Total assets found: ${data.assets.length}`);

    const descriptionsMap = new Map<string, any>(
      data.descriptions.map((desc: any) => [String(desc.classid), desc])
    );

    // Filter only Doppler / Gamma Doppler items
    const dopplerAssets = data.assets.filter((asset: any) => {
      const description = descriptionsMap.get(asset.classid);
      const name = description?.market_hash_name || description?.name || '';
      return name.includes('Doppler');
    });

    console.log(`Found ${dopplerAssets.length} Doppler/Gamma Doppler assets.`);
    if (dopplerAssets.length === 0) {
      console.log('No Doppler items found in bot inventory.');
      return;
    }

    const apiKey = process.env.CSFLOAT_API_KEY;
    if (!apiKey) {
      throw new Error("CSFLOAT_API_KEY requerido para consultar CSFloat.");
    }
    console.log("Using CSFloat API Key from environment.");

    const updatedItemsToSave: EnrichedStoreItem[] = [];

    for (const asset of dopplerAssets) {
      const description = descriptionsMap.get(asset.classid);
      const baseName = description?.market_hash_name || description?.name || '';
      const assetId = asset.assetid;

      // Extract inspect link structure
      const actions = description?.actions || [];
      const inspectAction = actions.find((act: any) => act.name && act.name.includes("Inspect"));
      let inspectLink = null;
      if (inspectAction && inspectAction.link) {
        inspectLink = inspectAction.link
          .replace("%owner_steamid%", botSteamId)
          .replace("%assetid%", assetId);
      }

      if (!inspectLink) {
        console.log(`[-] No inspect link for asset ${assetId} (${baseName})`);
        continue;
      }

      console.log(`\n[+] Resolving phase for asset ${assetId} (${baseName})...`);
      console.log(`    Inspect Link: ${inspectLink}`);

      try {
        // Query CSFloat API
        const csfloatResponse = await fetch(`https://api.csfloat.com/v1/lookup?url=${encodeURIComponent(inspectLink)}`, {
          headers: {
            'Authorization': apiKey,
          },
        });

        if (!csfloatResponse.ok) {
          console.error(`    [-] CSFloat lookup failed: ${csfloatResponse.status} ${csfloatResponse.statusText}`);
          await sleep(1000);
          continue;
        }

        const floatData = (await csfloatResponse.json()) as any;
        const phase = floatData?.iteminfo?.phase;

        if (phase) {
          const newName = `${baseName} | ${phase}`;
          console.log(`    [✓] DETECTED PHASE: "${phase}" -> New Name: "${newName}"`);
          
          updatedItemsToSave.push({
            assetId,
            classId: asset.classid,
            name: newName,
            type: description?.type || '',
            price: 0,
          });
        } else {
          console.log(`    [-] No phase attribute returned by CSFloat for this item.`);
        }
      } catch (err) {
        console.error(`    [-] Error querying CSFloat:`, err);
      }

      // Polite delay between API calls
      await sleep(1200);
    }

    if (updatedItemsToSave.length === 0) {
      console.log('\nNo Doppler items were successfully matched to any CSFloat phase.');
      return;
    }

    console.log(`\n2. Querying cs2.sh latest high-tier prices for ${updatedItemsToSave.length} resolved Doppler items...`);
    const enrichedItems = await PriceEnrichmentService.enrichItemsWithMarketPrices(updatedItemsToSave);

    console.log('\n3. Updating database records with CSFloat Phases and clean pricing...');
    for (const enriched of enrichedItems) {
      await prisma.storeItem.update({
        where: { assetId: enriched.assetId },
        data: {
          name: enriched.name,
          price: enriched.price,
        },
      });
      console.log(`[DB Updated] AssetID: ${enriched.assetId} -> "${enriched.name}" - $${enriched.price} USD`);
    }

    console.log('\nSuccess! All Doppler database records have been fully migrated and pricing is live.');
  } catch (error) {
    console.error('Error during Doppler CSFloat lookup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
