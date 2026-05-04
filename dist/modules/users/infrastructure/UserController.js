"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserController = void 0;
class UserController {
    createUserUseCase;
    getUsersUseCase;
    loginUserUseCase;
    constructor(createUserUseCase, getUsersUseCase, loginUserUseCase) {
        this.createUserUseCase = createUserUseCase;
        this.getUsersUseCase = getUsersUseCase;
        this.loginUserUseCase = loginUserUseCase;
    }
    async getAll(req, res) {
        try {
            const users = await this.getUsersUseCase.execute();
            res.json(users);
        }
        catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
    async create(req, res) {
        try {
            const user = await this.createUserUseCase.execute(req.body);
            // Remove password from response
            const { password: _, ...userWithoutPassword } = user;
            res.status(201).json(userWithoutPassword);
        }
        catch (error) {
            res.status(400).json({ error: error.message });
        }
    }
    async login(req, res) {
        const { email, password } = req.body;
        try {
            const result = await this.loginUserUseCase.execute(email, password);
            res.json(result);
        }
        catch (error) {
            res.status(401).json({ error: error.message });
        }
    }
}
exports.UserController = UserController;
//# sourceMappingURL=UserController.js.map