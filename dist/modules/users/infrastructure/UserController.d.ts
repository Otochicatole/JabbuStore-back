import { Request, Response } from 'express';
import { CreateUserUseCase, GetUsersUseCase, LoginUserUseCase } from '../application/UserUseCases';
export declare class UserController {
    private createUserUseCase;
    private getUsersUseCase;
    private loginUserUseCase;
    constructor(createUserUseCase: CreateUserUseCase, getUsersUseCase: GetUsersUseCase, loginUserUseCase: LoginUserUseCase);
    getAll(req: Request, res: Response): Promise<void>;
    create(req: Request, res: Response): Promise<void>;
    login(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=UserController.d.ts.map