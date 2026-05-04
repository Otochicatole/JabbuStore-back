import { Router } from 'express';
import { AdminController } from './AdminController';
import { CreateAdminUseCase, GetAdminsUseCase, LoginAdminUseCase } from '../application/AdminUseCases';
import { PrismaAdminRepository } from './PrismaAdminRepository';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';
import { validate } from '../../../shared/infrastructure/middlewares/validationMiddleware';
import { createAdminSchema, loginAdminSchema } from './adminSchemas';

const router = Router();

const adminRepository = new PrismaAdminRepository();
const createAdminUseCase = new CreateAdminUseCase(adminRepository);
const getAdminsUseCase = new GetAdminsUseCase(adminRepository);
const loginAdminUseCase = new LoginAdminUseCase(adminRepository);
const adminController = new AdminController(createAdminUseCase, getAdminsUseCase, loginAdminUseCase);

router.get('/', authMiddleware, adminOnly, (req, res) => adminController.getAll(req, res));
router.post('/', authMiddleware, adminOnly, validate(createAdminSchema), (req, res) => adminController.create(req, res));
router.post('/login', validate(loginAdminSchema), (req, res) => adminController.login(req, res));

export default router;
