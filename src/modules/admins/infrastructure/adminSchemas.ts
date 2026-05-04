import { z } from 'zod';

export const createAdminSchema = z.object({
  body: z.object({
    username: z.string().min(3).max(30),
    email: z.string().email(),
    password: z.string().min(8).max(100),
    role: z.enum(['ADMIN', 'SUPER_ADMIN']).optional(),
  }),
});

export const loginAdminSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});
