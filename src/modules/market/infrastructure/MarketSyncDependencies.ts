import { config } from "../../../shared/config";
import { SteamWebApiItemsCatalogStore } from "../../pricing";
import { CollectMarketAssetsCatalogUseCase } from "../application/CollectMarketAssetsCatalogUseCase";
import { GetMarketSyncStatusUseCase } from "../application/GetMarketSyncStatusUseCase";
import { MarketAssetsCatalogPublisher } from "../application/MarketAssetsCatalogPublisher";
import { MarketAssetsPriorityQueueBuilder } from "../application/MarketAssetsPriorityQueue";
import { RefreshMarketAssetsCatalogUseCase } from "../application/RefreshMarketAssetsCatalogUseCase";
import { RunFullCatalogSyncUseCase } from "../application/RunFullCatalogSyncUseCase";
import { MarketAssetsCatalogStore } from "./MarketAssetsCatalogStore";
import { PrismaMarketRepository } from "./PrismaMarketRepository";
import { PrismaMarketSyncStateRepository } from "./PrismaMarketSyncStateRepository";
import { SteamWebApiFloatAssetsClient } from "./SteamWebApiFloatAssetsClient";
import { SteamWebApiMarketAssetsCatalogClient } from "./SteamWebApiMarketAssetsCatalogClient";

// Nuevos imports para refactor YouPin
import { SyncYoupinCatalogUseCase } from "../application/SyncYoupinCatalogUseCase";
import { GetOrRefreshListingFloatsUseCase } from "../application/GetOrRefreshListingFloatsUseCase";
import { FloatCachePolicy } from "../application/FloatCachePolicy";
import { YoupinFloatAssetsDownloader } from "../application/YoupinFloatAssetsDownloader";

export const marketRepository = new PrismaMarketRepository();
export const marketSyncStateRepository =
  new PrismaMarketSyncStateRepository();
export const marketAssetsCatalogStore = new MarketAssetsCatalogStore(
  config.marketAssetsCatalog.snapshotPath,
  config.marketAssetsCatalog.checkpointPath,
  config.marketAssetsCatalog.target,
);

const itemsCatalogStore = new SteamWebApiItemsCatalogStore();
const queueBuilder = new MarketAssetsPriorityQueueBuilder(itemsCatalogStore);
const assetsClient = new SteamWebApiMarketAssetsCatalogClient(
  new SteamWebApiFloatAssetsClient(),
);
const collector = new CollectMarketAssetsCatalogUseCase(
  assetsClient,
  queueBuilder,
  marketAssetsCatalogStore,
  marketSyncStateRepository,
  undefined,
  {
    targetAssets: config.marketAssetsCatalog.target,
    assetsPerItem: config.marketAssetsCatalog.assetsPerItem,
    concurrency: config.marketAssetsCatalog.concurrency,
    sort: config.marketAssetsCatalog.sort,
  },
);

export const refreshMarketAssetsCatalogUseCase =
  new RefreshMarketAssetsCatalogUseCase(
    collector,
    marketAssetsCatalogStore,
    new MarketAssetsCatalogPublisher(marketRepository),
    marketSyncStateRepository,
  );

// Instanciar los nuevos casos de uso del refactor
export const syncYoupinCatalogUseCase = new SyncYoupinCatalogUseCase(
  marketRepository,
  marketSyncStateRepository,
);

export const getOrRefreshListingFloatsUseCase = new GetOrRefreshListingFloatsUseCase(
  marketRepository,
  new FloatCachePolicy(),
  new YoupinFloatAssetsDownloader(),
);

// Actualizar RunFullCatalogSyncUseCase para que use la nueva lógica de sync global (Proceso 1)
export const runFullCatalogSyncUseCase = new RunFullCatalogSyncUseCase(
  syncYoupinCatalogUseCase as any, // Hacemos cast a any temporalmente si las interfaces no machean
  marketSyncStateRepository,
);

export const getMarketSyncStatusUseCase = new GetMarketSyncStatusUseCase(
  marketAssetsCatalogStore,
  marketSyncStateRepository,
);
