export interface Notification {
  id: string;
  userId: string | null;
  adminId: string | null;
  title: string;
  content: string;
  type: string; // e.g. "TICKET_MESSAGE" | "ORDER_STATUS" | "SYSTEM"
  read: boolean;
  link: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface INotificationRepository {
  create(data: Partial<Notification>): Promise<Notification>;
  findUnreadByUserId(userId: string): Promise<Notification[]>;
  findUnreadByAdminId(adminId: string): Promise<Notification[]>;
  findAllByUserId(userId: string): Promise<Notification[]>;
  findAllByAdminId(adminId: string): Promise<Notification[]>;
  findById(id: string): Promise<Notification | null>;
  markAsRead(id: string): Promise<Notification>;
  markAllAsReadForUser(userId: string): Promise<void>;
  markAllAsReadForAdmin(adminId: string): Promise<void>;
  clearAllForUser(userId: string): Promise<void>;
  clearAllForAdmin(adminId: string): Promise<void>;
  delete(id: string): Promise<void>;
  findExistingUnread(
    userId: string | null,
    adminId: string | null,
    type: string,
    link: string
  ): Promise<Notification | null>;
  update(id: string, data: Partial<Notification>): Promise<Notification>;
}
