import { z } from 'zod';

export const identityInputSchema = z.object({
  cedula: z
    .string()
    .regex(/^\d{10}$/, 'cedula must be 10 numeric digits')
    .describe('Ecuadorian cedula — 10 digits, format-validated only'),
});

export type IdentityInput = z.infer<typeof identityInputSchema>;

export const identityOutputSchema = z.object({
  name: z.string().min(1).describe('Full legal name from Registro Civil'),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('ISO YYYY-MM-DD'),
  valid: z
    .boolean()
    .describe('false when the person is deceased — derived from deathDate presence'),
});

export type IdentityOutput = z.infer<typeof identityOutputSchema>;
