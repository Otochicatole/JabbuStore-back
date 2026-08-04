import { Router } from 'express';
import { MarketController } from './MarketController';
import { GetMarketStoreAssetsUseCase } from '../application/GetMarketStoreAssetsUseCase';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';
import {
  marketRepository,
  getOrRefreshListingFloatsUseCase,
} from './MarketSyncDependencies';

const router = Router();

// Inyección de dependencias del módulo market
const getMarketStoreAssetsUseCase = new GetMarketStoreAssetsUseCase(marketRepository);

const marketController = new MarketController(
  getMarketStoreAssetsUseCase,
  getOrRefreshListingFloatsUseCase,
);

// Ruta pública — catálogo YouPin (un asset/float por fila; admin y /buy reventa)
router.get('/listings', (req, res) => marketController.getListings(req, res));

// Ruta pública — obtener floats de un resale item
router.get('/listings/:id/floats', (req, res) => marketController.getFloats(req, res));

// Rutas protegidas (Admin) — ejecuciones manuales paso a paso
router.post('/download-items-catalog', authMiddleware, adminOnly, (req, res) =>
  marketController.downloadItemsCatalog(req, res),
);

router.post('/generate-catalog-global', authMiddleware, adminOnly, (req, res) =>
  marketController.generateCatalogGlobal(req, res),
);
router.post('/sync-catalog-global-db', authMiddleware, adminOnly, (req, res) =>
  marketController.syncCatalogGlobalDb(req, res),
);


export default router;
