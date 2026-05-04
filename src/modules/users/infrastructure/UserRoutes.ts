import { Router } from 'express';
import { UserController } from './UserController';
import { CreateUserUseCase, GetUsersUseCase, LoginUserUseCase } from '../application/UserUseCases';
import { PrismaUserRepository } from './PrismaUserRepository';
import { authMiddleware } from '../../../shared/infrastructure/middlewares/authMiddleware';
import { validate } from '../../../shared/infrastructure/middlewares/validationMiddleware';
import { createUserSchema, loginUserSchema } from './userSchemas';

const router = Router();

// Dependency Injection
const userRepository = new PrismaUserRepository();
const createUserUseCase = new CreateUserUseCase(userRepository);
const getUsersUseCase = new GetUsersUseCase(userRepository);
const loginUserUseCase = new LoginUserUseCase(userRepository);
const userController = new UserController(createUserUseCase, getUsersUseCase, loginUserUseCase);

router.get('/', authMiddleware, (req, res) => userController.getAll(req, res));
router.post('/', validate(createUserSchema), (req, res) => userController.create(req, res));
router.post('/login', validate(loginUserSchema), (req, res) => userController.login(req, res));

export default router;
