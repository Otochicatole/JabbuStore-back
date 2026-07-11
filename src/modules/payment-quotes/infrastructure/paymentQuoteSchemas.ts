import { z } from "zod";

export const createPaymentQuoteSchema = z.object({
  body: z.object({
    type: z.enum(["BUY", "raffle"]),
    itemIds: z.array(z.string().min(1)).optional(),
    items: z.array(z.any()).optional(),
    raffleId: z.string().min(1).nullable().optional(),
    ticketsCount: z.coerce.number().int().positive().max(1000).optional(),
    paymentMethod: z.string().min(1),
    manualTransferType: z.enum(["bank", "crypto"]).nullable().optional(),
  }),
});
