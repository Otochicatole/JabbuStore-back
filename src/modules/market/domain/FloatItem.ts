export interface FloatItem {
  id?: string;
  assetId: string;
  floatValue: number;
  paintSeed: number;
  market: 'BUFF' | 'YOUPIN';
  price: number; // Original market price in USD
  inspectLink?: string | null;
  available?: boolean;
  externalId?: string | null;
  lastSyncAt?: Date;
  resaleItemId: string;
}
