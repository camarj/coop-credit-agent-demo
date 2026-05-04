import { z } from 'zod';

export const bureauInputSchema = z.object({
  cedula: z
    .string()
    .regex(/^\d{10}$/, 'cedula must be 10 numeric digits'),
});

export type BureauInput = z.infer<typeof bureauInputSchema>;

export const hardInquirySchema = z.object({
  at: z.number().int().nonnegative(),
  source: z.string().min(1),
});

export const bureauOutputSchema = z.object({
  score: z
    .number()
    .int()
    .nonnegative()
    .describe('Reported credit score after this hard pull'),
  history: z.array(hardInquirySchema).describe('Recent hard inquiries'),
  hardInquiriesCount: z
    .number()
    .int()
    .nonnegative()
    .describe('Total inquiries on file (including this one)'),
});

export type BureauOutput = z.infer<typeof bureauOutputSchema>;
