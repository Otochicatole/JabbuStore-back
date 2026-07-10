import { z } from "zod";

const reviewStatuses = ["PENDING", "APPROVED", "REJECTED"] as const;

export const listPublicReviewsSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
});

export const createReviewSchema = z.object({
  body: z.object({
    body: z.string().trim().min(3).max(500),
  }),
});

export const adminListReviewsSchema = z.object({
  query: z.object({
    status: z.enum(reviewStatuses).optional(),
  }),
});

export const reviewIdParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});
