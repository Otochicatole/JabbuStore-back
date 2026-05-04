"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetAdminsUseCase = exports.LoginAdminUseCase = exports.CreateAdminUseCase = void 0;
const AuthService_1 = require("../../../shared/infrastructure/AuthService");
class CreateAdminUseCase {
    adminRepository;
    constructor(adminRepository) {
        this.adminRepository = adminRepository;
    }
    async execute(adminData) {
        const existing = await this.adminRepository.findByEmail(adminData.email);
        if (existing) {
            throw new Error('Admin already exists');
        }
        if (adminData.password) {
            adminData.password = await AuthService_1.AuthService.hashPassword(adminData.password);
        }
        return this.adminRepository.save(adminData);
    }
}
exports.CreateAdminUseCase = CreateAdminUseCase;
class LoginAdminUseCase {
    adminRepository;
    constructor(adminRepository) {
        this.adminRepository = adminRepository;
    }
    async execute(email, password) {
        const admin = await this.adminRepository.findByEmail(email);
        if (!admin) {
            throw new Error('Invalid credentials');
        }
        const isValid = await AuthService_1.AuthService.comparePassword(password, admin.password);
        if (!isValid) {
            throw new Error('Invalid credentials');
        }
        const token = AuthService_1.AuthService.generateToken({ id: admin.id, email: admin.email, role: 'ADMIN' });
        // Remove password from response
        const { password: _, ...adminWithoutPassword } = admin;
        return { admin: adminWithoutPassword, token };
    }
}
exports.LoginAdminUseCase = LoginAdminUseCase;
class GetAdminsUseCase {
    adminRepository;
    constructor(adminRepository) {
        this.adminRepository = adminRepository;
    }
    async execute() {
        return this.adminRepository.findAll();
    }
}
exports.GetAdminsUseCase = GetAdminsUseCase;
//# sourceMappingURL=AdminUseCases.js.map