import { z } from 'zod';

export const createTicketSchema = z.object({
  orderId: z.string().uuid(),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(1).max(2000),
});

export const ticketStatusSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']),
});

export const ticketMessageSchema = z.object({
  ticketId: z.string().uuid(),
  clientMessageId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

export const ticketIdSchema = z.string().uuid();
