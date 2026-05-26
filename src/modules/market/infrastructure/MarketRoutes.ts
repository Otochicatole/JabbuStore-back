import { Router } from 'express';
import { MarketController } from './MarketController';
import { PrismaMarketRepository } from './PrismaMarketRepository';
import { GetMarketListingsUseCase } from '../application/GetMarketListingsUseCase';
import { SyncMarketListingsUseCase } from '../application/SyncMarketListingsUseCase';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';

const router = Router();

// Inyección de dependencias del módulo market
const marketRepository = new PrismaMarketRepository();
const getMarketListingsUseCase = new GetMarketListingsUseCase(marketRepository);
const syncMarketListingsUseCase = new SyncMarketListingsUseCase(marketRepository);
const marketController = new MarketController(getMarketListingsUseCase, syncMarketListingsUseCase);

// Ruta pública — catálogo de market listings con displayPrice
router.get('/listings', (req, res) => marketController.getListings(req, res));

// Ruta protegida — solo admin puede forzar una resincronización manual
router.post('/sync', authMiddleware, adminOnly, (req, res) => marketController.triggerSync(req, res));

export default router;
