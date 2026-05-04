import { IAdminRepository, Admin } from '../domain/Admin';
export declare class CreateAdminUseCase {
    private adminRepository;
    constructor(adminRepository: IAdminRepository);
    execute(adminData: Partial<Admin>): Promise<Admin>;
}
export declare class LoginAdminUseCase {
    private adminRepository;
    constructor(adminRepository: IAdminRepository);
    execute(email: string, password: string): Promise<{
        admin: Admin;
        token: string;
    }>;
}
export declare class GetAdminsUseCase {
    private adminRepository;
    constructor(adminRepository: IAdminRepository);
    execute(): Promise<Admin[]>;
}
//# sourceMappingURL=AdminUseCases.d.ts.map