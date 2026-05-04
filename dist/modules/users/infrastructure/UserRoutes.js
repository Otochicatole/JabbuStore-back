"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const UserController_1 = require("./UserController");
const UserUseCases_1 = require("../application/UserUseCases");
const PrismaUserRepository_1 = require("./PrismaUserRepository");
const authMiddleware_1 = require("../../../shared/infrastructure/middlewares/authMiddleware");
const validationMiddleware_1 = require("../../../shared/infrastructure/middlewares/validationMiddleware");
const userSchemas_1 = require("./userSchemas");
const router = (0, express_1.Router)();
// Dependency Injection
const userRepository = new PrismaUserRepository_1.PrismaUserRepository();
const createUserUseCase = new UserUseCases_1.CreateUserUseCase(userRepository);
const getUsersUseCase = new UserUseCases_1.GetUsersUseCase(userRepository);
const loginUserUseCase = new UserUseCases_1.LoginUserUseCase(userRepository);
const userController = new UserController_1.UserController(createUserUseCase, getUsersUseCase, loginUserUseCase);
router.get('/', authMiddleware_1.authMiddleware, (req, res) => userController.getAll(req, res));
router.post('/', (0, validationMiddleware_1.validate)(userSchemas_1.createUserSchema), (req, res) => userController.create(req, res));
router.post('/login', (0, validationMiddleware_1.validate)(userSchemas_1.loginUserSchema), (req, res) => userController.login(req, res));
exports.default = router;
//# sourceMappingURL=UserRoutes.js.map