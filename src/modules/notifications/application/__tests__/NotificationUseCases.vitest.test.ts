import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSendDbNotification, mockSendNotificationEmail } = vi.hoisted(() => ({
  mockSendDbNotification: vi.fn(),
  mockSendNotificationEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../../tickets/infrastructure/TicketSocket", () => ({
  sendDbNotification: mockSendDbNotification,
}));

vi.mock("../../../../shared/infrastructure/SendGridService", () => ({
  SendGridService: {
    sendNotificationEmail: mockSendNotificationEmail,
  },
}));

import type { INotificationRepository, Notification } from "../../domain/Notification";
import { CreateOrUpdateNotificationUseCase } from "../NotificationUseCases";

function buildRepo(existing: Notification | null = null): INotificationRepository {
  const baseNotification: Notification = {
    id: "notif-1",
    userId: null,
    adminId: null,
    title: "notifications.newTicket.title",
    content: "{}",
    type: "TICKET_MESSAGE",
    read: false,
    link: "/admin/panel/tickets?ticket=t-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    create: vi.fn(async (data) => ({
      ...baseNotification,
      ...data,
      userId: data.userId ?? null,
      adminId: data.adminId ?? null,
      link: data.link ?? null,
    })),
    findUnreadByUserId: vi.fn(async () => []),
    findUnreadByAdminId: vi.fn(async () => []),
    findAllByUserId: vi.fn(async () => []),
    findAllByAdminId: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    markAsRead: vi.fn(async () => baseNotification),
    markAllAsReadForUser: vi.fn(async () => undefined),
    markAllAsReadForAdmin: vi.fn(async () => undefined),
    clearAllForUser: vi.fn(async () => undefined),
    clearAllForAdmin: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    findExistingUnread: vi.fn(async () => existing),
    update: vi.fn(async (_id, data) => ({
      ...(existing ?? baseNotification),
      ...data,
    })),
  };
}

describe("CreateOrUpdateNotificationUseCase", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("dispatches SendGrid email for new admin notifications (userId === null)", async () => {
    const repo = buildRepo(null);
    const useCase = new CreateOrUpdateNotificationUseCase(repo);

    await useCase.execute({
      userId: null,
      adminId: null,
      title: "notifications.newBuyOrder.title",
      content: "{}",
      type: "ORDER_STATUS",
      link: "/admin/panel/orders/purchase?id=ord-1",
    });

    expect(mockSendDbNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it("dispatches SendGrid email when an unread admin notification is updated", async () => {
    const existing: Notification = {
      id: "notif-existing",
      userId: null,
      adminId: null,
      title: "notifications.newTicket.title",
      content: "old",
      type: "TICKET_MESSAGE",
      read: false,
      link: "/admin/panel/tickets?ticket=t-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const repo = buildRepo(existing);
    const useCase = new CreateOrUpdateNotificationUseCase(repo);

    await useCase.execute({
      userId: null,
      adminId: null,
      title: "notifications.ticketAlert",
      content: "new message",
      type: "TICKET_MESSAGE",
      link: "/admin/panel/tickets?ticket=t-1",
    });

    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(mockSendNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch SendGrid admin email for customer notifications (userId !== null)", async () => {
    const repo = buildRepo(null);
    const useCase = new CreateOrUpdateNotificationUseCase(repo);

    await useCase.execute({
      userId: "user-123",
      adminId: null,
      title: "notifications.tradePending.title",
      content: "{}",
      type: "ORDER_STATUS",
      link: "/purchases",
    });

    expect(mockSendDbNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });
});
