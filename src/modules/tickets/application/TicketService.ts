import { prisma } from '../../../shared/infrastructure/PrismaClient';
import { randomUUID } from 'node:crypto';
import { PrismaNotificationRepository } from '../../notifications/infrastructure/PrismaNotificationRepository';
import { CreateOrUpdateNotificationUseCase } from '../../notifications/application/NotificationUseCases';

export interface TicketActor {
  id: string;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
}

const isAdmin = (actor: TicketActor) => actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';

function messageDto(message: any) {
  return {
    id: message.id,
    ticketId: message.ticketId,
    senderType: message.senderType,
    senderUserId: message.senderUserId,
    senderAdminId: message.senderAdminId,
    clientMessageId: message.clientMessageId,
    body: message.body,
    createdAt: message.createdAt,
  };
}

async function ticketDto(ticket: any, actor: TicketActor) {
  const lastReadAt = isAdmin(actor) ? ticket.adminLastReadAt : ticket.userLastReadAt;
  const oppositeSender = isAdmin(actor) ? 'USER' : 'ADMIN';
  const unreadCount = await prisma.ticketMessage.count({
    where: {
      ticketId: ticket.id,
      senderType: oppositeSender,
      ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
    },
  });

  return {
    id: ticket.id,
    orderId: ticket.orderId,
    userId: ticket.userId,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    closedAt: ticket.closedAt,
    order: ticket.order,
    user: ticket.user,
    lastMessage: ticket.messages?.[0] ? messageDto(ticket.messages[0]) : null,
    unreadCount,
  };
}

export class TicketService {
  static async create(actor: TicketActor, input: { orderId: string; subject: string; message: string }) {
    const isActorAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';

    const { result, userId, ticket } = await prisma.$transaction(async (tx) => {
      // Find the order
      const order = isActorAdmin
        ? await tx.order.findUnique({ where: { id: input.orderId } })
        : await tx.order.findFirst({ where: { id: input.orderId, userId: actor.id } });

      if (!order) throw new Error('ORDER_NOT_FOUND');

      const orderUserId = order.userId; // Ticket belongs to the order owner

      const openCount = await tx.orderTicket.count({
        where: { orderId: input.orderId, userId: orderUserId, status: 'OPEN' },
      });
      if (openCount >= 3) throw new Error('OPEN_TICKET_LIMIT');

      const createdTicket = await tx.orderTicket.create({
        data: {
          orderId: input.orderId,
          userId: orderUserId,
          subject: input.subject,
          userLastReadAt: isActorAdmin ? null : new Date(),
          adminLastReadAt: isActorAdmin ? new Date() : null,
          messages: {
            create: {
              senderType: isActorAdmin ? 'ADMIN' : 'USER',
              senderUserId: isActorAdmin ? null : actor.id,
              senderAdminId: isActorAdmin ? actor.id : null,
              clientMessageId: randomUUID(),
              body: input.message,
            },
          },
        },
        include: {
          order: { select: { id: true, type: true, status: true, totalPrice: true } },
          user: { select: { id: true, name: true, steamId: true, avatar: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      const dto = await ticketDto(createdTicket, actor);
      return { result: dto, userId: orderUserId, ticket: createdTicket };
    });

    // Crear notificación después de confirmar la transacción en DB
    try {
      const notificationRepo = new PrismaNotificationRepository();
      const createNotificationUseCase = new CreateOrUpdateNotificationUseCase(notificationRepo);
      if (isActorAdmin) {
        // Notify client user
        await createNotificationUseCase.execute({
          userId,
          adminId: null,
          title: 'notifications.newTicket.title',
          content: input.message.slice(0, 160),
          type: 'TICKET_MESSAGE',
          link: `/tickets?ticket=${ticket.id}`,
        });
      } else {
        // Notify admins
        await createNotificationUseCase.execute({
          userId: null,
          adminId: null,
          title: 'notifications.newTicket.title',
          content: JSON.stringify({
            key: 'notifications.newTicket.content',
            params: {
              userName: ticket.user?.name || 'Steam User',
              subject: input.subject,
            },
          }),
          type: 'TICKET_MESSAGE',
          link: `/admin/panel/tickets?ticket=${ticket.id}`,
        });
      }
    } catch (err) {
      console.error('[TicketService.create] Error creating database notification:', err);
    }

    return result;
  }

  static async list(actor: TicketActor, options: { orderId?: string; status?: string; search?: string }) {
    const where: any = {
      ...(isAdmin(actor) ? {} : { userId: actor.id }),
      ...(options.orderId ? { orderId: options.orderId } : {}),
      ...(options.status === 'OPEN' || options.status === 'CLOSED' ? { status: options.status } : {}),
    };
    if (isAdmin(actor) && options.search) {
      where.OR = [
        { subject: { contains: options.search } },
        { orderId: { contains: options.search } },
        { user: { name: { contains: options.search } } },
        { user: { steamId: { contains: options.search } } },
      ];
    }

    const tickets = await prisma.orderTicket.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 100,
      include: {
        order: { select: { id: true, type: true, status: true, totalPrice: true } },
        user: { select: { id: true, name: true, steamId: true, avatar: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return Promise.all(tickets.map((ticket) => ticketDto(ticket, actor)));
  }

  static async assertAccess(ticketId: string, actor: TicketActor) {
    const ticket = await prisma.orderTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || (!isAdmin(actor) && ticket.userId !== actor.id)) {
      throw new Error('TICKET_NOT_FOUND');
    }
    return ticket;
  }

  static async notificationContext(ticketId: string) {
    const ticket = await prisma.orderTicket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        orderId: true,
        subject: true,
        userId: true,
        user: { select: { name: true, avatar: true } },
      },
    });
    if (!ticket) throw new Error('TICKET_NOT_FOUND');
    return ticket;
  }

  static async messages(ticketId: string, actor: TicketActor, cursor?: string) {
    await this.assertAccess(ticketId, actor);
    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = messages.length > 50;
    const page = messages.slice(0, 50);
    return {
      messages: page.reverse().map(messageDto),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  static async markRead(
    ticketId: string,
    actor: TicketActor,
  ): Promise<{ ticket: Awaited<ReturnType<typeof TicketService.assertAccess>>; changed: boolean }> {
    const ticket = await this.assertAccess(ticketId, actor);
    const actorIsAdmin = isAdmin(actor);
    const lastReadAt = actorIsAdmin ? ticket.adminLastReadAt : ticket.userLastReadAt;
    const oppositeSender = actorIsAdmin ? 'USER' : 'ADMIN';

    const unreadCount = await prisma.ticketMessage.count({
      where: {
        ticketId,
        senderType: oppositeSender,
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });

    if (unreadCount === 0) {
      return { ticket, changed: false };
    }

    const now = new Date();
    const updated = await prisma.orderTicket.update({
      where: { id: ticketId },
      data: {
        ...(actorIsAdmin ? { adminLastReadAt: now } : { userLastReadAt: now }),
        // Preservar updatedAt explícitamente para que abrir/leer un ticket jamás altere su orden en la lista
        updatedAt: ticket.updatedAt,
      },
    });

    return { ticket: updated, changed: true };
  }

  static async sendMessage(
    actor: TicketActor,
    input: { ticketId: string; clientMessageId: string; body: string },
  ) {
    const ticket = await this.assertAccess(input.ticketId, actor);
    if (ticket.status === 'CLOSED') throw new Error('TICKET_CLOSED');

    const existing = await prisma.ticketMessage.findUnique({
      where: {
        ticketId_clientMessageId: {
          ticketId: input.ticketId,
          clientMessageId: input.clientMessageId,
        },
      },
    });
    if (existing) return messageDto(existing);

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.ticketMessage.create({
        data: {
          ticketId: input.ticketId,
          senderType: isAdmin(actor) ? 'ADMIN' : 'USER',
          senderAdminId: isAdmin(actor) ? actor.id : null,
          senderUserId: isAdmin(actor) ? null : actor.id,
          clientMessageId: input.clientMessageId,
          body: input.body,
        },
      });
      await tx.orderTicket.update({
        where: { id: input.ticketId },
        data: {
          updatedAt: new Date(),
          ...(isAdmin(actor) ? { adminLastReadAt: new Date() } : { userLastReadAt: new Date() }),
        },
      });
      return created;
    });

    // Crear notificación para el receptor del mensaje
    try {
      const notificationRepo = new PrismaNotificationRepository();
      const createNotificationUseCase = new CreateOrUpdateNotificationUseCase(notificationRepo);
      const isSenderAdmin = isAdmin(actor);

      if (isSenderAdmin) {
        await createNotificationUseCase.execute({
          userId: ticket.userId,
          adminId: null,
          title: 'notifications.ticketAlert',
          content: input.body.slice(0, 160),
          type: 'TICKET_MESSAGE',
          link: `/tickets?ticket=${ticket.id}`,
        });
      } else {
        const sender = await prisma.user.findUnique({
          where: { id: actor.id },
          select: { name: true }
        });
        const senderName = sender?.name || 'Steam User';

        await createNotificationUseCase.execute({
          userId: null,
          adminId: null,
          title: 'notifications.ticketAlert',
          content: JSON.stringify({
            key: 'notifications.newTicketMessage.content',
            params: {
              senderName,
              message: input.body.slice(0, 160),
            },
          }),
          type: 'TICKET_MESSAGE',
          link: `/admin/panel/tickets?ticket=${ticket.id}`,
        });
      }
    } catch (err) {
      console.error('[TicketService.sendMessage] Error creating database notification:', err);
    }

    return messageDto(message);
  }

  static async setStatus(ticketId: string, adminId: string, status: 'OPEN' | 'CLOSED') {
    const ticket = await prisma.orderTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new Error('TICKET_NOT_FOUND');
    return prisma.orderTicket.update({
      where: { id: ticketId },
      data: status === 'CLOSED'
        ? { status, closedAt: new Date(), closedByAdminId: adminId, updatedAt: ticket.updatedAt }
        : { status, closedAt: null, closedByAdminId: null, updatedAt: ticket.updatedAt },
    });
  }

  static async get(ticketId: string, actor: TicketActor) {
    await this.assertAccess(ticketId, actor);
    const ticket = await prisma.orderTicket.findUnique({
      where: { id: ticketId },
      include: {
        order: { select: { id: true, type: true, status: true, totalPrice: true } },
        user: { select: { id: true, name: true, steamId: true, avatar: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!ticket) throw new Error('TICKET_NOT_FOUND');
    return ticketDto(ticket, actor);
  }
}
