import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { AuthService } from '../../../shared/infrastructure/AuthService';
import { TicketService, type TicketActor } from '../application/TicketService';
import { ticketIdSchema, ticketMessageSchema } from './ticketSchemas';

type Ack = (response: { ok: boolean; data?: unknown; error?: string }) => void;

let io: Server | null = null;

const actorRoom = (actor: TicketActor) =>
  actor.role === 'USER' ? `user:${actor.id}` : 'ticket-admins';

export function initializeTicketSocket(server: HttpServer) {
  const allowedOrigins = [
    'http://localhost:3000',
    process.env.FRONTEND_URL || '',
  ].filter(Boolean);

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['X-Tunnel-Skip-AntiPhishing-Page'],
    },
    maxHttpBufferSize: 100_000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 120_000,
      skipMiddlewares: false,
    },
  });

  io.use((socket, next) => {
    const token = typeof socket.handshake.auth?.token === 'string'
      ? socket.handshake.auth.token
      : '';
    const verified = token ? AuthService.verifySocketToken(token) : null;
    
    if (verified && ['USER', 'ADMIN', 'SUPER_ADMIN'].includes(verified.role)) {
      socket.data.actor = verified as TicketActor;
    } else {
      socket.data.actor = { id: 'guest', role: 'GUEST' };
    }
    
    next();
  });

  io.on('connection', (socket) => {
    const actor = socket.data.actor as TicketActor | { id: string; role: 'GUEST' };
    
    if (actor.role !== 'GUEST') {
      socket.join(actorRoom(actor as TicketActor));
    }

    const sentAt: number[] = [];

    socket.on('raffle:join_live', (payload: { raffleId: string }) => {
      if (payload?.raffleId) {
        socket.join(`raffle:live:${payload.raffleId}`);
      }
    });

    socket.on('raffle:leave_live', (payload: { raffleId: string }) => {
      if (payload?.raffleId) {
        socket.leave(`raffle:live:${payload.raffleId}`);
      }
    });

    socket.on('ticket:join', async (payload: unknown, ack?: Ack) => {
      if (actor.role === 'GUEST') return ack?.({ ok: false, error: 'UNAUTHORIZED' });
      try {
        const parsed = ticketIdSchema.safeParse((payload as any)?.ticketId);
        if (!parsed.success) throw new Error('INVALID_TICKET');
        await TicketService.assertAccess(parsed.data, actor);
        await socket.join(`ticket:${parsed.data}`);
        const ticket = await TicketService.markRead(parsed.data, actor);
        io?.to('ticket-admins').to(`user:${ticket.userId}`).emit('ticket:updated', {
          ticketId: parsed.data,
        });
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'JOIN_FAILED' });
      }
    });

    socket.on('ticket:leave', (payload: unknown) => {
      if (actor.role === 'GUEST') return;
      const parsed = ticketIdSchema.safeParse((payload as any)?.ticketId);
      if (parsed.success) socket.leave(`ticket:${parsed.data}`);
    });

    socket.on('ticket:read', async (payload: unknown, ack?: Ack) => {
      if (actor.role === 'GUEST') return ack?.({ ok: false, error: 'UNAUTHORIZED' });
      try {
        const parsed = ticketIdSchema.safeParse((payload as any)?.ticketId);
        if (!parsed.success) throw new Error('INVALID_TICKET');
        const ticket = await TicketService.markRead(parsed.data, actor);
        io?.to(`ticket:${parsed.data}`).emit('ticket:read', {
          ticketId: parsed.data,
          actor: actor.role === 'USER' ? 'USER' : 'ADMIN',
        });
        io?.to('ticket-admins').to(`user:${ticket.userId}`).emit('ticket:updated', {
          ticketId: parsed.data,
        });
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'READ_FAILED' });
      }
    });

    socket.on('message:send', async (payload: unknown, ack?: Ack) => {
      if (actor.role === 'GUEST') return ack?.({ ok: false, error: 'UNAUTHORIZED' });
      try {
        const now = Date.now();
        while (sentAt.length && sentAt[0]! < now - 10_000) sentAt.shift();
        if (sentAt.length >= 5) throw new Error('RATE_LIMITED');
        const parsed = ticketMessageSchema.safeParse(payload);
        if (!parsed.success) throw new Error('INVALID_MESSAGE');
        sentAt.push(now);
        const message = await TicketService.sendMessage(actor, parsed.data);
        const ticket = await TicketService.notificationContext(parsed.data.ticketId);
        io?.to(`ticket:${parsed.data.ticketId}`).emit('message:new', message);
        io?.to('ticket-admins').to(`user:${ticket.userId}`)
          .emit('ticket:updated', { ticketId: parsed.data.ticketId });
        const recipientRoom = actor.role === 'USER'
          ? 'ticket-admins'
          : `user:${ticket.userId}`;
        socket.to(recipientRoom).emit('notification:new', {
          messageId: message.id,
          ticketId: ticket.id,
          orderId: ticket.orderId,
          subject: ticket.subject,
          senderName: actor.role === 'USER'
            ? ticket.user.name || 'Steam User'
            : 'Soporte JabbuStore',
          senderAvatar: actor.role === 'USER' ? ticket.user.avatar : null,
          preview: message.body.slice(0, 160),
          createdAt: message.createdAt,
        });
        ack?.({ ok: true, data: message });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'SEND_FAILED' });
      }
    });
  });

  return io;
}

export function emitTicketStatus(ticket: { id: string; userId: string; status: string }) {
  io?.to(`ticket:${ticket.id}`).emit('ticket:status', {
    ticketId: ticket.id,
    status: ticket.status,
  });
  io?.to('ticket-admins').to(`user:${ticket.userId}`).emit('ticket:updated', {
    ticketId: ticket.id,
  });
}

export function emitTicketUpdated(ticket: { id: string; userId: string }) {
  io?.to('ticket-admins').to(`user:${ticket.userId}`).emit('ticket:updated', {
    ticketId: ticket.id,
  });
}

export function emitTicketCreatedNotification(ticket: {
  id: string;
  orderId: string;
  subject: string;
  user?: { name?: string | null; avatar?: string | null } | null;
  lastMessage?: { id: string; body: string; createdAt: Date | string } | null;
}) {
  if (!ticket.lastMessage) return;
  io?.to('ticket-admins').emit('notification:new', {
    messageId: ticket.lastMessage.id,
    ticketId: ticket.id,
    orderId: ticket.orderId,
    subject: ticket.subject,
    senderName: ticket.user?.name || 'Steam User',
    senderAvatar: ticket.user?.avatar || null,
    preview: ticket.lastMessage.body.slice(0, 160),
    createdAt: ticket.lastMessage.createdAt,
  });
}

export function sendDbNotification(notification: any) {
  if (!io) return;
  if (notification.userId) {
    io.to(`user:${notification.userId}`).emit('notification:new_db', notification);
  } else {
    io.to('ticket-admins').emit('notification:new_db', notification);
  }
}

export function emitLiveRaffleStart(raffleId: string) {
  io?.to(`raffle:live:${raffleId}`).emit('raffle:live:start', { raffleId });
}

export function emitLiveRaffleResult(raffleId: string, result: any) {
  io?.to(`raffle:live:${raffleId}`).emit('raffle:live:result', {
    raffleId,
    ...result
  });
}

