import { IUserRepository, User } from '../domain/User';
export declare class PrismaUserRepository implements IUserRepository {
    save(user: any): Promise<User>;
    findAll(): Promise<User[]>;
    findByEmail(email: string): Promise<User | null>;
}
//# sourceMappingURL=PrismaUserRepository.d.ts.map