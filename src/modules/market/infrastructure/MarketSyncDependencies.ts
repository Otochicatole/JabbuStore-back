import { config } from "../../../shared/config";
import { PrismaMarketRepository } from "./PrismaMarketRepository";

import { GetOrRefreshListingFloatsUseCase } from "../application/GetOrRefreshListingFloatsUseCase";
import { FloatCachePolicy } from "../application/FloatCachePolicy";
import { YoupinFloatAssetsDownloader } from "../application/YoupinFloatAssetsDownloader";
import { GetListingInspectLinkUseCase } from "../application/GetListingInspectLinkUseCase";
import { SteamWebApiFloatAssetsClient } from "./SteamWebApiFloatAssetsClient";

export const marketRepository = new PrismaMarketRepository();

export const getOrRefreshListingFloatsUseCase = new GetOrRefreshListingFloatsUseCase(
  marketRepository,
  new FloatCachePolicy(),
  new YoupinFloatAssetsDownloader(),
);

export const getListingInspectLinkUseCase = new GetListingInspectLinkUseCase(
  new SteamWebApiFloatAssetsClient(),
);
