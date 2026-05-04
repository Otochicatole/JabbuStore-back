import { Request, Response } from 'express';
import { CreateAdminUseCase, GetAdminsUseCase, LoginAdminUseCase } from '../application/AdminUseCases';
export declare class AdminController {
    private createAdminUseCase;
    private getAdminsUseCase;
    private loginAdminUseCase;
    constructor(createAdminUseCase: CreateAdminUseCase, getAdminsUseCase: GetAdminsUseCase, loginAdminUseCase: LoginAdminUseCase);
    getAll(req: Request, res: Response): Promise<void>;
    create(req: Request, res: Response): Promise<void>;
    login(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=AdminController.d.ts.map