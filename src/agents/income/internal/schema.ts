import { z } from 'zod';

export const incomeInputSchema = z.object({
  cedula: z
    .string()
    .regex(/^\d{10}$/, 'cedula must be 10 numeric digits')
    .describe('Ecuadorian cedula — 10 digits, format-validated only'),
});

export type IncomeInput = z.infer<typeof incomeInputSchema>;

export const incomeOutputSchema = z.object({
  employer: z.string().min(1).describe('Employer name as registered at IESS'),
  salary: z
    .number()
    .nonnegative()
    .describe('Declared monthly salary in USD'),
  monthsActive: z
    .number()
    .int()
    .nonnegative()
    .describe('Months of continuous active affiliation'),
});

export type IncomeOutput = z.infer<typeof incomeOutputSchema>;
