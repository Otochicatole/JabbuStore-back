import { IAdminRepository, Admin } from '../domain/Admin';
export declare class PrismaAdminRepository implements IAdminRepository {
    save(admin: any): Promise<Admin>;
    findAll(): Promise<Admin[]>;
    findByEmail(email: string): Promise<Admin | null>;
}
//# sourceMappingURL=PrismaAdminRepository.d.ts.map