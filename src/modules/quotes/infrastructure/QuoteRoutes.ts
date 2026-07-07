import { Router } from 'express';
import { QuoteController } from './QuoteController';
import {
  CreateQuoteUseCase,
  GetUserQuotesUseCase,
  GetQuoteByIdUseCase,
  CancelQuoteUseCase,
  AdminGetQuotesUseCase,
  AdminQuoteItemsUseCase
} from '../application/QuoteUseCases';
import { authMiddleware, adminOnly } from '../../../shared/infrastructure/middlewares/authMiddleware';

const router = Router();

// Instantiate Use Cases
const createQuoteUseCase = new CreateQuoteUseCase();
const getUserQuotesUseCase = new GetUserQuotesUseCase();
const getQuoteByIdUseCase = new GetQuoteByIdUseCase();
const cancelQuoteUseCase = new CancelQuoteUseCase();
const adminGetQuotesUseCase = new AdminGetQuotesUseCase();
const adminQuoteItemsUseCase = new AdminQuoteItemsUseCase();

// Instantiate Controller
const quoteController = new QuoteController(
  createQuoteUseCase,
  getUserQuotesUseCase,
  getQuoteByIdUseCase,
  cancelQuoteUseCase,
  adminGetQuotesUseCase,
  adminQuoteItemsUseCase
);

// User routes
router.post('/', authMiddleware, (req, res) => quoteController.create(req, res));
router.get('/me', authMiddleware, (req, res) => quoteController.getMyQuotes(req, res));
router.get('/:id', authMiddleware, (req, res) => quoteController.getById(req, res));
router.post('/:id/cancel', authMiddleware, (req, res) => quoteController.cancel(req, res));

// Admin routes
router.get('/admin/all', authMiddleware, adminOnly, (req, res) => quoteController.adminGetAll(req, res));
router.patch('/admin/:id/quote', authMiddleware, adminOnly, (req, res) => quoteController.adminQuoteItems(req, res));
router.post('/admin/:id/cancel', authMiddleware, adminOnly, (req, res) => quoteController.adminCancel(req, res));

export default router;
