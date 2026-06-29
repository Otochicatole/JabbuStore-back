import { INotificationRepository, Notification } from '../domain/Notification';
import { sendDbNotification } from '../../tickets/infrastructure/TicketSocket';

export class CreateOrUpdateNotificationUseCase {
  constructor(private notificationRepository: INotificationRepository) {}

  async execute(data: Partial<Notification>): Promise<Notification> {
    const userId = data.userId || null;
    const adminId = data.adminId || null;
    const type = data.type || 'SYSTEM';
    const link = data.link || null;

    let notification: Notification;

    // Si es del tipo ticket o similar, agrupamos en un solo unread notification
    if (link) {
      const existing = await this.notificationRepository.findExistingUnread(
        userId,
        adminId,
        type,
        link
      );

      if (existing) {
        // Actualizamos la existente
        const updateData: Partial<Notification> = {
          createdAt: new Date(),
        };
        if (data.title !== undefined) updateData.title = data.title;
        if (data.content !== undefined) updateData.content = data.content;

        notification = await this.notificationRepository.update(existing.id, updateData);
      } else {
        // Creamos nueva
        notification = await this.notificationRepository.create(data);
      }
    } else {
      // Creamos nueva directamente
      notification = await this.notificationRepository.create(data);
    }

    // Emitir en tiempo real
    try {
      sendDbNotification(notification);
    } catch (err) {
      console.error('[CreateOrUpdateNotificationUseCase] Error emitting real-time notification:', err);
    }

    return notification;
  }
}

export class GetNotificationsUseCase {
  constructor(private notificationRepository: INotificationRepository) {}

  async execute(actor: { id: string; role: string }): Promise<Notification[]> {
    if (actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN') {
      return this.notificationRepository.findAllByAdminId(actor.id);
    } else {
      return this.notificationRepository.findAllByUserId(actor.id);
    }
  }
}

export class MarkNotificationAsReadUseCase {
  constructor(private notificationRepository: INotificationRepository) {}

  async execute(id: string, actor: { id: string; role: string }): Promise<Notification> {
    const notification = await this.notificationRepository.findById(id);
    if (!notification) {
      throw new Error('NOTIFICATION_NOT_FOUND');
    }

    // Seguridad: verificar que pertenece al actor
    const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
    if (isAdmin) {
      // Si es de admin, es válida si adminId es null (notificación general de admin) o coincide con el admin actual
      const isAuthorized = notification.adminId === actor.id || (notification.adminId === null && notification.userId === null);
      if (!isAuthorized) {
        throw new Error('UNAUTHORIZED');
      }
    } else {
      if (notification.userId !== actor.id) {
        throw new Error('UNAUTHORIZED');
      }
    }

    return this.notificationRepository.markAsRead(id);
  }
}

export class MarkAllNotificationsAsReadUseCase {
  constructor(private notificationRepository: INotificationRepository) {}

  async execute(actor: { id: string; role: string }): Promise<void> {
    if (actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN') {
      await this.notificationRepository.markAllAsReadForAdmin(actor.id);
    } else {
      await this.notificationRepository.markAllAsReadForUser(actor.id);
    }
  }
}
