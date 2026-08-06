import { config } from "../../../shared/config";
import { PrismaMarketRepository } from "./PrismaMarketRepository";

import { GetOrRefreshListingFloatsUseCase } from "../application/GetOrRefreshListingFloatsUseCase";
import { FloatCachePolicy } from "../application/FloatCachePolicy";
import { YoupinFloatAssetsDownloader } from "../application/YoupinFloatAssetsDownloader";

export const marketRepository = new PrismaMarketRepository();

export const getOrRefreshListingFloatsUseCase = new GetOrRefreshListingFloatsUseCase(
  marketRepository,
  new FloatCachePolicy(),
  new YoupinFloatAssetsDownloader(),
);
