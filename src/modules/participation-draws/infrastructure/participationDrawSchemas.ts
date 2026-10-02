import { z } from "zod";

const prizeSchema = z.object({
  assetId: z.string().min(1),
  position: z.coerce.number().int().min(1).default(1),
});

export const drawIdParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const createParticipationDrawSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    minRaffles: z.coerce.number().int().min(1),
    drawDate: z.coerce.date(),
    isPublic: z.boolean().optional(),
    prizes: z.array(prizeSchema).min(1),
  }),
});

export const updateParticipationDrawSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    minRaffles: z.coerce.number().int().min(1).optional(),
    drawDate: z.coerce.date().optional(),
    isPublic: z.boolean().optional(),
    prizes: z.array(prizeSchema).min(1).optional(),
  }),
});

export const manualDrawParticipationDrawSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    assignments: z
      .array(
        z.object({
          prizeId: z.string().min(1),
          winnerId: z.string().min(1),
        }),
      )
      .min(1),
  }),
});
