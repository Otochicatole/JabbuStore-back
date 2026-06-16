/**
 * Representa un ítem de reventa obtenido del catálogo de cs2.sh (YouPin).
 * A diferencia de StoreItem, estos ítems NO están en el inventario físico de los bots.
 * Son listings de mercados externos que se sincronizán periódicamente.
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

/** Payload para crear/actualizar un listing desde cs2.sh */
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
