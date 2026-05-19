import { Router } from 'express';
import { UserController } from './UserController';
import { CreateUserUseCase, GetUsersUseCase, LoginUserUseCase, GetUserInventoryUseCase, GetUserProfileUseCase, UpdateUserProfileUseCase } from '../application/UserUseCases';
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
const getUserInventoryUseCase = new GetUserInventoryUseCase(userRepository);
const getUserProfileUseCase = new GetUserProfileUseCase(userRepository);
const updateUserProfileUseCase = new UpdateUserProfileUseCase(userRepository);
const userController = new UserController(
  createUserUseCase,
  getUsersUseCase,
  loginUserUseCase,
  getUserInventoryUseCase,
  getUserProfileUseCase,
  updateUserProfileUseCase
);

router.get('/', authMiddleware, (req, res) => userController.getAll(req, res));
router.get('/me', authMiddleware, (req, res) => userController.getMe(req, res));
router.patch('/me', authMiddleware, (req, res) => userController.updateMe(req, res));
router.get('/me/inventory', authMiddleware, (req, res) => userController.getInventory(req, res));
router.post('/', validate(createUserSchema), (req, res) => userController.create(req, res));
router.post('/login', validate(loginUserSchema), (req, res) => userController.login(req, res));

export default router;
