import { Router } from 'express';
import { CatalogController } from './CatalogController';

const router = Router();
const catalogController = new CatalogController();

router.get('/items', (req, res) => catalogController.getItems(req, res));

export default router;
