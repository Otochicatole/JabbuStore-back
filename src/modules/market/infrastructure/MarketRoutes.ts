import { Router } from 'express';
import { MarketController } from './MarketController';
import { PrismaMarketRepository } from './PrismaMarketRepository';
import { GetMarketStoreAssetsUseCase } from '../application/GetMarketStoreAssetsUseCase';
import { SyncMarketListingsUseCase } from '../application/SyncMarketListingsUseCase';
import { GetResaleItemFloatsUseCase } from '../application/GetResaleItemFloatsUseCase';
import { SyncStoreItemsUseCase } from '../../store/application/SyncStoreItemsUseCase';
import { PrismaStoreRepository } from '../../store/infrastructure/PrismaStoreRepository';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';
import { PrismaMarketSyncStateRepository } from './PrismaMarketSyncStateRepository';

const router = Router();

// Inyección de dependencias del módulo market
const marketRepository = new PrismaMarketRepository();
const marketSyncStateRepository = new PrismaMarketSyncStateRepository();
const storeRepository = new PrismaStoreRepository();
const getMarketStoreAssetsUseCase = new GetMarketStoreAssetsUseCase(marketRepository);
const syncMarketListingsUseCase = new SyncMarketListingsUseCase(
  marketRepository,
  marketSyncStateRepository,
);
const getResaleItemFloatsUseCase = new GetResaleItemFloatsUseCase(marketRepository);
const syncStoreItemsUseCase = new SyncStoreItemsUseCase(storeRepository);

const marketController = new MarketController(
  getMarketStoreAssetsUseCase,
  syncMarketListingsUseCase,
  getResaleItemFloatsUseCase,
  syncStoreItemsUseCase
);

// Ruta pública — catálogo YouPin (un asset/float por fila; admin y /buy reventa)
router.get('/listings', (req, res) => marketController.getListings(req, res));

// Ruta pública — obtener floats de un resale item
router.get('/listings/:id/floats', (req, res) => marketController.getFloats(req, res));

// Ruta protegida — solo admin puede forzar una resincronización manual
router.post('/sync', authMiddleware, adminOnly, (req, res) => marketController.triggerSync(req, res));

// Ruta protegida — obtener estado de la sincronización en curso
router.get('/sync/status', authMiddleware, adminOnly, (req, res) => marketController.getSyncStatus(req, res));

export default router;
