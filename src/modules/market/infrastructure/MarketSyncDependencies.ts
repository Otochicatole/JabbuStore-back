import { GetListingInspectLinkUseCase } from "../application/GetListingInspectLinkUseCase";
import { SteamWebApiFloatAssetsClient } from "./SteamWebApiFloatAssetsClient";

export const getListingInspectLinkUseCase = new GetListingInspectLinkUseCase(
  new SteamWebApiFloatAssetsClient(),
);
