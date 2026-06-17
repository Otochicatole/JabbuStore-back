/**
 * Representa un ítem de reventa indexado desde YouPin vía /steam/api/float/assets.
 * Cada listing agrupa uno o más assets reales con float; ver FloatItem.
 */
export interface MarketListing {
  id: string;
  name: string;
  /** Plataforma de reventa: 'youpin' */
  provider: 'youpin';
  youpinAsk: number | null;
  youpinVolume: number | null;
  /** Precio base seleccionado automáticamente */
  price: number;
  iconUrl: string | null;
  rarity: string;
  exterior: string | null;
  category: string;
  isStatTrak: boolean;
  isSouvenir: boolean;
  isPriceManual: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Payload para crear/actualizar un listing desde /steam/api/float/assets (precio = mínimo de sus FloatItem). */
export interface MarketListingUpsert {
  name: string;
  provider: 'youpin';
  youpinAsk: number | null;
  youpinVolume: number | null;
  price: number;
  iconUrl: string | null;
  rarity: string;
  exterior: string | null;
  category: string;
  isStatTrak: boolean;
  isSouvenir: boolean;
}
