"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetUsersUseCase = exports.LoginUserUseCase = exports.CreateUserUseCase = void 0;
const AuthService_1 = require("../../../shared/infrastructure/AuthService");
class CreateUserUseCase {
    userRepository;
    constructor(userRepository) {
        this.userRepository = userRepository;
    }
    async execute(userData) {
        const existing = await this.userRepository.findByEmail(userData.email);
        if (existing) {
            throw new Error('User already exists');
        }
        if (userData.password) {
            userData.password = await AuthService_1.AuthService.hashPassword(userData.password);
        }
        return this.userRepository.save(userData);
    }
}
exports.CreateUserUseCase = CreateUserUseCase;
class LoginUserUseCase {
    userRepository;
    constructor(userRepository) {
        this.userRepository = userRepository;
    }
    async execute(email, password) {
        const user = await this.userRepository.findByEmail(email);
        if (!user) {
            throw new Error('Invalid credentials');
        }
        const isValid = await AuthService_1.AuthService.comparePassword(password, user.password);
        if (!isValid) {
            throw new Error('Invalid credentials');
        }
        const token = AuthService_1.AuthService.generateToken({ id: user.id, email: user.email, role: 'USER' });
        // Remove password from response
        const { password: _, ...userWithoutPassword } = user;
        return { user: userWithoutPassword, token };
    }
}
exports.LoginUserUseCase = LoginUserUseCase;
class GetUsersUseCase {
    userRepository;
    constructor(userRepository) {
        this.userRepository = userRepository;
    }
    async execute() {
        return this.userRepository.findAll();
    }
}
exports.GetUsersUseCase = GetUsersUseCase;
//# sourceMappingURL=UserUseCases.js.map