import { z } from "zod";

const sponsorNameSchema = z.string().trim().min(1).max(80);

const booleanFromFormData = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const sponsorIdParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const createSponsorSchema = z.object({
  body: z.object({
    name: sponsorNameSchema,
  }),
});

export const updateSponsorSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    name: sponsorNameSchema.optional(),
    isActive: booleanFromFormData.optional(),
  }),
});

export const reorderSponsorsSchema = z.object({
  body: z.object({
    ids: z
      .array(z.string().min(1))
      .min(1)
      .superRefine((ids, context) => {
        if (new Set(ids).size !== ids.length) {
          context.addIssue({
            code: "custom",
            message: "Sponsor IDs must be unique.",
          });
        }
      }),
  }),
});
