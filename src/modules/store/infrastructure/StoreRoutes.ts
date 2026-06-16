import { Router } from 'express';
import { StoreController } from './StoreController';
import { GetStoreItemsUseCase } from '../application/GetStoreItemsUseCase';
import { PrismaStoreRepository } from './PrismaStoreRepository';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';

const router = Router();

// Inyección de dependencias para el módulo de Store / Artículos a la venta
const storeRepository = new PrismaStoreRepository();
const getStoreItemsUseCase = new GetStoreItemsUseCase(storeRepository);
const storeController = new StoreController(getStoreItemsUseCase, storeRepository);

// Ruta pública para obtener todos los artículos disponibles para la venta
router.get('/items', (req, res) => storeController.getItems(req, res));

// Ruta protegida para que el admin fuerce un recálculo rápido de precios locales con YouPin
router.post('/sync-prices', authMiddleware, adminOnly, (req, res) => storeController.syncPrices(req, res));

export default router;
