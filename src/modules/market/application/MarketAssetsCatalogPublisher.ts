import type { FloatItem } from '../domain/FloatItem';
import type { IMarketRepository } from '../domain/IMarketRepository';
import type { MarketListingUpsert } from '../domain/MarketListing';
import type {
  MarketAssetCatalogItem,
  MarketAssetsCatalogSnapshot,
} from '../domain/MarketAssetsCatalog';

export interface MarketCatalogPublicationResult {
  listings: number;
  floats: number;
}

interface PublicationGroup {
  listing: MarketListingUpsert;
  floats: Omit<FloatItem, 'resaleItemId'>[];
}

function createGroup(item: MarketAssetCatalogItem): PublicationGroup {
  return {
    listing: {
      name: item.listingName,
      provider: 'youpin',
      youpinAsk: item.price,
      youpinVolume: 0,
      price: item.price,
      iconUrl: item.iconUrl,
      rarity: item.rarity,
      exterior: item.exterior,
      category: item.category,
      isStatTrak: item.isStatTrak,
      isSouvenir: item.isSouvenir,
    },
    floats: [],
  };
}

export class MarketAssetsCatalogPublisher {
  constructor(private readonly marketRepository: IMarketRepository) {}

  async publish(
    snapshot: MarketAssetsCatalogSnapshot,
  ): Promise<MarketCatalogPublicationResult> {
    const groups = new Map<string, PublicationGroup>();

    for (const item of snapshot.assets) {
      const group = groups.get(item.listingName) ?? createGroup(item);
      group.floats.push({
        assetId: item.assetId,
        floatValue: item.floatValue,
        paintSeed: item.paintSeed,
        market: 'YOUPIN',
        price: item.price,
        inspectLink: item.inspectLink,
        available: true,
        externalId: item.externalId,
        lastSyncAt: new Date(snapshot.fetchedAt),
      });
      group.listing.youpinVolume = group.floats.length;
      if (item.price < group.listing.price) {
        group.listing.price = item.price;
        group.listing.youpinAsk = item.price;
        group.listing.iconUrl = item.iconUrl;
      }
      groups.set(item.listingName, group);
    }

    const listings = [...groups.values()].map((group) => group.listing);
    const floatsByName = new Map(
      [...groups.entries()].map(([name, group]) => [name, group.floats]),
    );

    await this.marketRepository.replaceAutomaticCatalogWithFloats(
      listings,
      floatsByName,
    );
    return { listings: listings.length, floats: snapshot.assets.length };
  }
}
