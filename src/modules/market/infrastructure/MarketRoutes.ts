import { Router } from 'express';
import { MarketController } from './MarketController';
import { PrismaMarketRepository } from './PrismaMarketRepository';
import { GetMarketListingsUseCase } from '../application/GetMarketListingsUseCase';
import { SyncMarketListingsUseCase } from '../application/SyncMarketListingsUseCase';
import { GetResaleItemFloatsUseCase } from '../application/GetResaleItemFloatsUseCase';
import { SyncStoreItemsUseCase } from '../../store/application/SyncStoreItemsUseCase';
import { PrismaStoreRepository } from '../../store/infrastructure/PrismaStoreRepository';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';

const router = Router();

// Inyección de dependencias del módulo market
const marketRepository = new PrismaMarketRepository();
const storeRepository = new PrismaStoreRepository();
const getMarketListingsUseCase = new GetMarketListingsUseCase(marketRepository);
const syncMarketListingsUseCase = new SyncMarketListingsUseCase(marketRepository);
const getResaleItemFloatsUseCase = new GetResaleItemFloatsUseCase(marketRepository);
const syncStoreItemsUseCase = new SyncStoreItemsUseCase(storeRepository);

const marketController = new MarketController(
  getMarketListingsUseCase,
  syncMarketListingsUseCase,
  getResaleItemFloatsUseCase,
  syncStoreItemsUseCase
);

// Ruta pública — catálogo de market listings con displayPrice
router.get('/listings', (req, res) => marketController.getListings(req, res));

// Ruta pública — obtener floats de un resale item
router.get('/listings/:id/floats', (req, res) => marketController.getFloats(req, res));

// Ruta protegida — solo admin puede forzar una resincronización manual
router.post('/sync', authMiddleware, adminOnly, (req, res) => marketController.triggerSync(req, res));

export default router;
