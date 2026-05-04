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
}

export interface IUserRepository {
  save(user: Partial<User>): Promise<User>;
  findAll(): Promise<User[]>;
  findByEmail(email: string): Promise<User | null>;
  findBySteamId(steamId: string): Promise<User | null>;
}
