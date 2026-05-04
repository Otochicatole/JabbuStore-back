"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminController = void 0;
class AdminController {
    createAdminUseCase;
    getAdminsUseCase;
    loginAdminUseCase;
    constructor(createAdminUseCase, getAdminsUseCase, loginAdminUseCase) {
        this.createAdminUseCase = createAdminUseCase;
        this.getAdminsUseCase = getAdminsUseCase;
        this.loginAdminUseCase = loginAdminUseCase;
    }
    async getAll(req, res) {
        try {
            const admins = await this.getAdminsUseCase.execute();
            res.json(admins);
        }
        catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
    async create(req, res) {
        try {
            const admin = await this.createAdminUseCase.execute(req.body);
            // Remove password from response
            const { password: _, ...adminWithoutPassword } = admin;
            res.status(201).json(adminWithoutPassword);
        }
        catch (error) {
            res.status(400).json({ error: error.message });
        }
    }
    async login(req, res) {
        const { email, password } = req.body;
        try {
            const result = await this.loginAdminUseCase.execute(email, password);
            res.json(result);
        }
        catch (error) {
            res.status(401).json({ error: error.message });
        }
    }
}
exports.AdminController = AdminController;
//# sourceMappingURL=AdminController.js.map