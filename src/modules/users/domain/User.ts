export interface User {
  id: string;
  email: string;
  name: string | null;
  password?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserRepository {
  save(user: Partial<User>): Promise<User>;
  findAll(): Promise<User[]>;
  findByEmail(email: string): Promise<User | null>;
}
