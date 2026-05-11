export interface UserInventoryItem {
  assetId: string;
  classId: string;
  name: string;
  type: string;
  iconUrl: string | null;
  tradable: boolean;
  marketable: boolean;
  userId: string;
  price: number;
  rarity: string;
  exterior: string | null;
  category: string;
  isStatTrak: boolean;
  isSouvenir: boolean;
  float: number | null;
  pattern: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  password: string | null;
  steamId: string | null;
  avatar: string | null;
  profileUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  inventory?: UserInventoryItem[];
}

export interface IUserRepository {
  save(user: Partial<User>): Promise<User>;
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findBySteamId(steamId: string): Promise<User | null>;
  
  // Gestión de Inventario del Usuario guardado en DB
  getUserInventory(userId: string): Promise<UserInventoryItem[]>;
  saveUserInventory(userId: string, items: UserInventoryItem[]): Promise<void>;
}
