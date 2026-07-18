import { z } from 'zod';
import { DISPLAY_CURRENCIES } from '../../currency-conversion/domain/CurrencyConversion';

export const createUserSchema = z.object({
  body: z.object({
    email: z.string().email(),
    name: z.string().min(2).max(50).optional(),
    password: z.string()
      .min(8, 'Password must be at least 8 characters')
      .max(100)
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
  }),
});

export const loginUserSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const updateUserProfileSchema = z.object({
  body: z.object({
    name: z.string().max(50).nullable().optional(),
    email: z.string().email().nullable().optional(),
    tradeUrl: z.string().max(2048).nullable().optional(),
    preferredCurrency: z.enum(DISPLAY_CURRENCIES).optional(),
  }),
});
