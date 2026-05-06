import { Router } from 'express';
import { StoreController } from './StoreController';
import { GetStoreItemsUseCase } from '../application/GetStoreItemsUseCase';
import { PrismaStoreRepository } from './PrismaStoreRepository';

const router = Router();

// Inyección de dependencias para el módulo de Store / Artículos a la venta
const storeRepository = new PrismaStoreRepository();
const getStoreItemsUseCase = new GetStoreItemsUseCase(storeRepository);
const storeController = new StoreController(getStoreItemsUseCase);

// Ruta pública para obtener todos los artículos disponibles para la venta
router.get('/items', (req, res) => storeController.getItems(req, res));

export default router;
