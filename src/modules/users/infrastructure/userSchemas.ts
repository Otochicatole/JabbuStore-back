import { z } from 'zod';

export const createUserSchema = z.object({
  body: z.object({
    email: z.string().email(),
    name: z.string().min(2).max(50).optional(),
    password: z.string().min(8).max(100),
  }),
});

export const loginUserSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});
