import { IUserRepository, User } from '../domain/User';
export declare class CreateUserUseCase {
    private userRepository;
    constructor(userRepository: IUserRepository);
    execute(userData: Partial<User>): Promise<User>;
}
export declare class LoginUserUseCase {
    private userRepository;
    constructor(userRepository: IUserRepository);
    execute(email: string, password: string): Promise<{
        user: User;
        token: string;
    }>;
}
export declare class GetUsersUseCase {
    private userRepository;
    constructor(userRepository: IUserRepository);
    execute(): Promise<User[]>;
}
//# sourceMappingURL=UserUseCases.d.ts.map