import { z } from 'zod';

const ruleIdSchema = z
  .string()
  .regex(/^(MIC|GAR|EXC|SCO)-\d{3}$/, 'invalid rule id format');

export const policyInputSchema = z.object({
  cedula: z.string().regex(/^\d{10}$/),
  ingresos: z.number().positive(),
  monto: z.number().positive(),
  plazo: z.number().int().positive(),
  identity: z
    .object({
      name: z.string(),
      birthDate: z.string(),
      valid: z.boolean(),
    })
    .optional(),
  income: z
    .object({
      employer: z.string(),
      salary: z.number(),
      monthsActive: z.number(),
    })
    .optional(),
  bureau: z
    .object({
      score: z.number(),
      hardInquiriesCount: z.number(),
    })
    .optional(),
  alt_score: z
    .object({
      score: z.number(),
      signals: z.array(z.string()),
    })
    .optional(),
});

export type PolicyInput = z.infer<typeof policyInputSchema>;

export const policyOutputSchema = z.object({
  applies: z.array(ruleIdSchema).min(0),
  notes: z.string().min(1).describe('Brief explanation of why these rules apply'),
});

export type PolicyOutput = z.infer<typeof policyOutputSchema>;
