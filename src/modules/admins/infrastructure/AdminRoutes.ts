import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AdminController } from './AdminController';
import { CreateAdminUseCase, GetAdminsUseCase, LoginAdminUseCase } from '../application/AdminUseCases';
import { PrismaAdminRepository } from './PrismaAdminRepository';
import { authMiddleware, superAdminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';
import { validate } from '../../../shared/infrastructure/middlewares/validationMiddleware';
import { createAdminSchema, loginAdminSchema } from './adminSchemas';

const router = Router();
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const adminRepository = new PrismaAdminRepository();
const createAdminUseCase = new CreateAdminUseCase(adminRepository);
const getAdminsUseCase = new GetAdminsUseCase(adminRepository);
const loginAdminUseCase = new LoginAdminUseCase(adminRepository);
const adminController = new AdminController(createAdminUseCase, getAdminsUseCase, loginAdminUseCase);

router.get('/me', authMiddleware, (req, res) => {
  res.json({ admin: (req as any).user });
});
router.get('/', authMiddleware, superAdminOnly, (req, res) => adminController.getAll(req, res));
router.post('/', authMiddleware, superAdminOnly, validate(createAdminSchema), (req, res) => adminController.create(req, res));
router.post('/login', adminLoginLimiter, validate(loginAdminSchema), (req, res) => adminController.login(req, res));
router.post('/logout', (req, res) => adminController.logout(req, res));

export default router;
