export interface StoreItem {
  assetId: string;
  classId: string;
  name: string;
  type: string;
  iconUrl: string | null;
  tradable: boolean;
  marketable: boolean;
  botSteamId: string; // El SteamID del bot o cuenta de depósito que almacena este ítem
  price: number; // El precio de la skin determinado por cs2.sh o fallback
  rarity: string;
  exterior: string | null;
  category: string;
  isStatTrak: boolean;
  isSouvenir: boolean;
  float: number | null;
  pattern: number | null;
}
