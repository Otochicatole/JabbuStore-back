/** Ítem de tienda YouPin a nivel asset/float individual (una tarjeta por fila). */
export interface MarketStoreAsset {
  /** ID estable para carrito/órdenes: `youpin-{floatItemId}` */
  id: string;
  floatItemId: string;
  assetId: string;
  listingId: string;
  name: string;
  provider: 'youpin';
  youpinAsk: number | null;
  youpinVolume: number | null;
  price: number;
  floatValue: number;
  paintSeed: number;
  inspectLink: string | null;
  externalId: string | null;
  iconUrl: string | null;
  rarity: string;
  exterior: string | null;
  category: string;
  isStatTrak: boolean;
  isSouvenir: boolean;
}
