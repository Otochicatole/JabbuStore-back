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
import { PrismaMarketSyncRunRepository } from "./PrismaMarketSyncRunRepository";
import { PrismaMarketAssetCandidateHistoryRepository } from "./PrismaMarketAssetCandidateHistoryRepository";
import { MarketAssetRequestPacer } from "../application/MarketAssetRequestPacer";

export const marketRepository = new PrismaMarketRepository();
export const marketSyncRunRepository = new PrismaMarketSyncRunRepository();
export const marketAssetCandidateHistoryRepository =
  new PrismaMarketAssetCandidateHistoryRepository();
export const marketSyncStateRepository =
  new PrismaMarketSyncStateRepository(marketSyncRunRepository);
export const marketAssetsCatalogStore = new MarketAssetsCatalogStore(
  config.marketAssetsCatalog.snapshotPath,
  config.marketAssetsCatalog.checkpointPath,
  config.marketAssetsCatalog.target,
);

const itemsCatalogStore = new SteamWebApiItemsCatalogStore();
const queueBuilder = new MarketAssetsPriorityQueueBuilder(itemsCatalogStore);
const assetsClient = new SteamWebApiMarketAssetsCatalogClient(
  new SteamWebApiFloatAssetsClient(),
  new MarketAssetRequestPacer({
    initialStartsPerSecond:
      config.marketAssetsCatalog.initialRequestsPerSecond,
    maxStartsPerSecond:
      config.marketAssetsCatalog.maxRequestsPerSecond,
  }),
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
    initialConcurrency:
      config.marketAssetsCatalog.initialConcurrency,
    concurrency: config.marketAssetsCatalog.concurrency,
    forceMaxConcurrency:
      config.marketAssetsCatalog.forceMaxConcurrency,
    targetDurationSeconds:
      config.marketAssetsCatalog.targetDurationSeconds,
    sort: config.marketAssetsCatalog.sort,
  },
  {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    historyRepository: marketAssetCandidateHistoryRepository,
    runRepository: marketSyncRunRepository,
  },
);

export const refreshMarketAssetsCatalogUseCase =
  new RefreshMarketAssetsCatalogUseCase(
    collector,
    marketAssetsCatalogStore,
    new MarketAssetsCatalogPublisher(marketRepository),
    marketSyncStateRepository,
  );

export const runFullCatalogSyncUseCase = new RunFullCatalogSyncUseCase(
  refreshMarketAssetsCatalogUseCase,
  marketSyncStateRepository,
  marketSyncRunRepository,
);

export const getMarketSyncStatusUseCase = new GetMarketSyncStatusUseCase(
  marketAssetsCatalogStore,
  marketSyncStateRepository,
  marketSyncRunRepository,
);
