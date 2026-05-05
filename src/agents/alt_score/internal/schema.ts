import { z } from 'zod';

export const altScoreInputSchema = z.object({
  cedula: z.string().regex(/^\d{10}$/),
});

export type AltScoreInput = z.infer<typeof altScoreInputSchema>;

export const altScoreOutputSchema = z.object({
  score: z
    .number()
    .min(0)
    .max(100)
    .describe('Synthetic 0-100 score from spending patterns'),
  signals: z
    .array(z.string().min(1))
    .min(1)
    .describe('Qualitative tags driving the score'),
});

export type AltScoreOutput = z.infer<typeof altScoreOutputSchema>;
