import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AuthService } from '../../../shared/infrastructure/AuthService';
import {
  ticketActorAuth,
  ticketAdminAuth,
  ticketUserAuth,
} from '../../../shared/infrastructure/middlewares/authMiddleware';
import { TicketService, type TicketActor } from '../application/TicketService';
import { createTicketSchema, ticketIdSchema, ticketStatusSchema } from './ticketSchemas';
import {
  emitTicketCreatedNotification,
  emitTicketStatus,
  emitTicketUpdated,
} from './TicketSocket';

const router = Router();
const createLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true });
const actorFrom = (req: any): TicketActor => req.user as TicketActor;

function errorResponse(res: any, error: unknown) {
  const code = error instanceof Error ? error.message : 'TICKET_ERROR';
  const status = code === 'ORDER_NOT_FOUND' || code === 'TICKET_NOT_FOUND'
    ? 404
    : code === 'OPEN_TICKET_LIMIT'
      ? 409
      : 400;
  return res.status(status).json({ error: code });
}

router.post('/', ticketUserAuth, createLimiter, async (req, res) => {
  const parsed = createTicketSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_TICKET' });
  try {
    const ticket = await TicketService.create(actorFrom(req).id, parsed.data);
    emitTicketUpdated(ticket);
    emitTicketCreatedNotification(ticket);
    return res.status(201).json(ticket);
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.get('/me', ticketUserAuth, async (req, res) => {
  const orderId = typeof req.query.orderId === 'string' ? req.query.orderId : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  return res.json(await TicketService.list(actorFrom(req), {
    ...(orderId ? { orderId } : {}),
    ...(status ? { status } : {}),
  }));
});

router.get('/admin', ticketAdminAuth, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : undefined;
  return res.json(await TicketService.list(actorFrom(req), {
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
  }));
});

router.patch('/admin/:id/status', ticketAdminAuth, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const idResult = ticketIdSchema.safeParse(id);
  const bodyResult = ticketStatusSchema.safeParse(req.body);
  if (!idResult.success || !bodyResult.success) return res.status(400).json({ error: 'INVALID_STATUS' });
  try {
    const ticket = await TicketService.setStatus(idResult.data, actorFrom(req).id, bodyResult.data.status);
    emitTicketStatus(ticket);
    return res.json(ticket);
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.post('/socket-token', ticketActorAuth, (req, res) => {
  const actor = actorFrom(req);
  return res.json({
    token: AuthService.generateSocketToken({ id: actor.id, role: actor.role }),
    expiresIn: 120,
  });
});

router.get('/:id', ticketActorAuth, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = ticketIdSchema.safeParse(id);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_TICKET' });
  try {
    return res.json(await TicketService.get(parsed.data, actorFrom(req)));
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.get('/:id/messages', ticketActorAuth, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = ticketIdSchema.safeParse(id);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_TICKET' });
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  try {
    return res.json(await TicketService.messages(parsed.data, actorFrom(req), cursor));
  } catch (error) {
    return errorResponse(res, error);
  }
});

export default router;
