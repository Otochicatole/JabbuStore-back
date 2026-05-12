import 'dotenv/config';
import { prisma } from './shared/infrastructure/PrismaClient';
import { PriceEnrichmentService } from './shared/infrastructure/PriceEnrichmentService';

async function main() {
  console.log('--- DOPPLER DATABASE MIGRATION & PRICE REFRESH ---');

  try {
    const items = await prisma.storeItem.findMany();
    console.log(`Total items in StoreItem table: ${items.length}`);

    // Filter Doppler items that do NOT already have a phase appended
    const dopplerItems = items.filter(item => {
      const isDoppler = item.name.includes('Doppler');
      const hasPhase = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Ruby', 'Sapphire', 'Black Pearl', 'Emerald'].some(phase => item.name.includes(phase));
      return isDoppler && !hasPhase;
    });

    console.log(`Found ${dopplerItems.length} Doppler items to process and enrich...`);
    if (dopplerItems.length === 0) {
      console.log('No Doppler items need enrichment or all are already enriched.');
      return;
    }

    const updatedItems = [];
    const phaseMapping: Record<string, string> = {
      phase1: 'Phase 1',
      phase2: 'Phase 2',
      phase3: 'Phase 3',
      phase4: 'Phase 4',
      ruby: 'Ruby',
      sapphire: 'Sapphire',
      blackpearl: 'Black Pearl',
      emerald: 'Emerald'
    };

    for (const item of dopplerItems) {
      // Extract the icon hash from the full iconUrl
      let iconHash = null;
      if (item.iconUrl) {
        if (item.iconUrl.includes('economy/image/')) {
          iconHash = item.iconUrl.split('economy/image/')[1] || null;
        } else {
          iconHash = item.iconUrl;
        }
      }

      const detected = PriceEnrichmentService.detectDopplerPhase(item.name, iconHash, item.pattern);
      if (detected) {
        const phaseDisplayName = phaseMapping[detected];
        if (phaseDisplayName) {
          const newName = `${item.name} | ${phaseDisplayName}`;
          console.log(`Detected: "${item.name}" -> "${newName}" (${phaseDisplayName})`);
          
          updatedItems.push({
            ...item,
            name: newName,
          });
        }
      } else {
        console.log(`Could not detect phase for "${item.name}" (AssetID: ${item.assetId})`);
      }
    }

    if (updatedItems.length === 0) {
      console.log('No items were successfully matched to any Doppler phase.');
      return;
    }

    console.log(`\nFetching precise phase-specific prices from cs2.sh for ${updatedItems.length} items...`);
    
    // Enrich items with correct phase-specific prices
    const enrichedItems = await PriceEnrichmentService.enrichItemsWithMarketPrices(updatedItems);

    console.log('\nUpdating database records...');
    for (const enriched of enrichedItems) {
      await prisma.storeItem.update({
        where: { assetId: enriched.assetId },
        data: {
          name: enriched.name,
          price: enriched.price,
        },
      });
      console.log(`Updated AssetID: ${enriched.assetId}`);
      console.log(`  New Name: "${enriched.name}"`);
      console.log(`  New Price: $${enriched.price} USD`);
      console.log('-------------------------');
    }

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Error during Doppler migration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
