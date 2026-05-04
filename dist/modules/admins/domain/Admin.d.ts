export interface Admin {
    id: string;
    username: string;
    email: string;
    password?: string;
    role: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface IAdminRepository {
    save(admin: Partial<Admin>): Promise<Admin>;
    findAll(): Promise<Admin[]>;
    findByEmail(email: string): Promise<Admin | null>;
}
//# sourceMappingURL=Admin.d.ts.map