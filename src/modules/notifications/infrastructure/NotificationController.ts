import { Request, Response } from 'express';
import {
  GetNotificationsUseCase,
  MarkNotificationAsReadUseCase,
  MarkAllNotificationsAsReadUseCase,
  ClearAllNotificationsUseCase,
} from '../application/NotificationUseCases';

export class NotificationController {
  constructor(
    private getNotificationsUseCase: GetNotificationsUseCase,
    private markNotificationAsReadUseCase: MarkNotificationAsReadUseCase,
    private markAllNotificationsAsReadUseCase: MarkAllNotificationsAsReadUseCase,
    private clearAllNotificationsUseCase: ClearAllNotificationsUseCase
  ) {}

  async getMyNotifications(req: Request, res: Response) {
    try {
      const actor = (req as any).user;
      if (!actor) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }

      const notifications = await this.getNotificationsUseCase.execute(actor);
      return res.json(notifications);
    } catch (error) {
      console.error('[NotificationController] Error in getMyNotifications:', error);
      return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  async markAsRead(req: Request, res: Response) {
    try {
      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;
      const actor = (req as any).user;
      if (!actor) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }

      if (!id) {
        return res.status(400).json({ error: 'INVALID_ID' });
      }

      const notification = await this.markNotificationAsReadUseCase.execute(id, actor);
      return res.json(notification);
    } catch (error: any) {
      console.error('[NotificationController] Error in markAsRead:', error);
      if (error.message === 'NOTIFICATION_NOT_FOUND') {
        return res.status(404).json({ error: 'NOTIFICATION_NOT_FOUND' });
      }
      if (error.message === 'UNAUTHORIZED') {
        return res.status(403).json({ error: 'UNAUTHORIZED' });
      }
      return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  async markAllAsRead(req: Request, res: Response) {
    try {
      const actor = (req as any).user;
      if (!actor) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }

      await this.markAllNotificationsAsReadUseCase.execute(actor);
      return res.json({ ok: true });
    } catch (error) {
      console.error('[NotificationController] Error in markAllAsRead:', error);
      return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  async clearAll(req: Request, res: Response) {
    try {
      const actor = (req as any).user;
      if (!actor) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }

      await this.clearAllNotificationsUseCase.execute(actor);
      return res.json({ ok: true });
    } catch (error) {
      console.error('[NotificationController] Error in clearAll:', error);
      return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
}
