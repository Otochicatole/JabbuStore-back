import { Router } from 'express';
import { MarketController } from './MarketController';
import { GetMarketStoreAssetsUseCase } from '../application/GetMarketStoreAssetsUseCase';
import { GetResaleItemFloatsUseCase } from '../application/GetResaleItemFloatsUseCase';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';
import {
  getMarketSyncStatusUseCase,
  marketRepository,
  runFullCatalogSyncUseCase,
} from './MarketSyncDependencies';

const router = Router();

// Inyección de dependencias del módulo market
const getMarketStoreAssetsUseCase = new GetMarketStoreAssetsUseCase(marketRepository);
const getResaleItemFloatsUseCase = new GetResaleItemFloatsUseCase(marketRepository);

const marketController = new MarketController(
  getMarketStoreAssetsUseCase,
  runFullCatalogSyncUseCase,
  getMarketSyncStatusUseCase,
  getResaleItemFloatsUseCase,
);

// Ruta pública — catálogo YouPin (un asset/float por fila; admin y /buy reventa)
router.get('/listings', (req, res) => marketController.getListings(req, res));

// Ruta pública — obtener floats de un resale item
router.get('/listings/:id/floats', (req, res) => marketController.getFloats(req, res));

// Ruta protegida — solo admin puede forzar una resincronización manual
router.post('/sync', authMiddleware, adminOnly, (req, res) => marketController.triggerSync(req, res));

// Ruta protegida — cancelar de forma cooperativa la recolección activa
router.post('/sync/cancel', authMiddleware, adminOnly, (req, res) => marketController.cancelSync(req, res));

// Ruta protegida — obtener estado de la sincronización en curso
router.get('/sync/status', authMiddleware, adminOnly, (req, res) => marketController.getSyncStatus(req, res));

export default router;
