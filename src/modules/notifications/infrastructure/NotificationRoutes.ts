import { Router } from 'express';
import { PrismaNotificationRepository } from './PrismaNotificationRepository';
import {
  GetNotificationsUseCase,
  MarkNotificationAsReadUseCase,
  MarkAllNotificationsAsReadUseCase,
} from '../application/NotificationUseCases';
import { NotificationController } from './NotificationController';
import { authMiddleware } from '../../../shared/infrastructure/middlewares/authMiddleware';

const router = Router();

const notificationRepository = new PrismaNotificationRepository();
const getNotificationsUseCase = new GetNotificationsUseCase(notificationRepository);
const markNotificationAsReadUseCase = new MarkNotificationAsReadUseCase(notificationRepository);
const markAllNotificationsAsReadUseCase = new MarkAllNotificationsAsReadUseCase(notificationRepository);

const notificationController = new NotificationController(
  getNotificationsUseCase,
  markNotificationAsReadUseCase,
  markAllNotificationsAsReadUseCase
);

router.get('/me', authMiddleware, (req, res) => notificationController.getMyNotifications(req, res));
router.patch('/:id/read', authMiddleware, (req, res) => notificationController.markAsRead(req, res));
router.post('/read-all', authMiddleware, (req, res) => notificationController.markAllAsRead(req, res));

export default router;
