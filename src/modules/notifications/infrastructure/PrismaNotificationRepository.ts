import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { INotificationRepository, Notification } from '../domain/Notification';

export class PrismaNotificationRepository implements INotificationRepository {
  async create(data: Partial<Notification>): Promise<Notification> {
    return prisma.notification.create({
      data: {
        userId: data.userId || null,
        adminId: data.adminId || null,
        title: data.title || '',
        content: data.content || '',
        type: data.type || 'SYSTEM',
        read: data.read || false,
        link: data.link || null,
      },
    }) as any;
  }

  async findUnreadByUserId(userId: string): Promise<Notification[]> {
    return prisma.notification.findMany({
      where: { userId, read: false },
      orderBy: { createdAt: 'desc' },
    }) as any;
  }

  async findUnreadByAdminId(adminId: string): Promise<Notification[]> {
    return prisma.notification.findMany({
      where: {
        OR: [
          { adminId, read: false },
          { adminId: null, userId: null, read: false }, // Shared admin notifications
        ],
      },
      orderBy: { createdAt: 'desc' },
    }) as any;
  }

  async findAllByUserId(userId: string): Promise<Notification[]> {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }) as any;
  }

  async findAllByAdminId(adminId: string): Promise<Notification[]> {
    return prisma.notification.findMany({
      where: {
        OR: [
          { adminId },
          { adminId: null, userId: null }, // Shared admin notifications
        ],
      },
      orderBy: { createdAt: 'desc' },
    }) as any;
  }

  async findById(id: string): Promise<Notification | null> {
    return prisma.notification.findUnique({
      where: { id },
    }) as any;
  }

  async markAsRead(id: string): Promise<Notification> {
    return prisma.notification.update({
      where: { id },
      data: { read: true },
    }) as any;
  }

  async markAllAsReadForUser(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  async markAllAsReadForAdmin(adminId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: {
        OR: [
          { adminId, read: false },
          { adminId: null, userId: null, read: false },
        ],
      },
      data: { read: true },
    });
  }

  async clearAllForUser(userId: string): Promise<void> {
    await prisma.notification.deleteMany({
      where: { userId },
    });
  }

  async clearAllForAdmin(adminId: string): Promise<void> {
    await prisma.notification.deleteMany({
      where: {
        OR: [
          { adminId },
          { adminId: null, userId: null },
        ],
      },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.notification.delete({
      where: { id },
    });
  }

  async findExistingUnread(
    userId: string | null,
    adminId: string | null,
    type: string,
    link: string
  ): Promise<Notification | null> {
    return prisma.notification.findFirst({
      where: {
        userId,
        adminId,
        type,
        link,
        read: false,
      },
    }) as any;
  }

  async update(id: string, data: Partial<Notification>): Promise<Notification> {
    return prisma.notification.update({
      where: { id },
      data: data as any,
    }) as any;
  }
}
