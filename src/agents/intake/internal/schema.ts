import { z } from 'zod';

export const intakeInputSchema = z.object({
  cedula: z
    .string()
    .regex(/^\d{10}$/)
    .describe('Cedula ecuatoriana de 10 digitos'),
  ingresos: z
    .number()
    .positive()
    .describe('Ingresos mensuales declarados en USD'),
  monto: z
    .number()
    .min(100)
    .max(50000)
    .describe('Monto solicitado en USD, entre 100 y 50000'),
  plazo: z
    .number()
    .int()
    .min(1)
    .max(60)
    .describe('Plazo del credito en meses, entre 1 y 60'),
});

export type IntakeInput = z.infer<typeof intakeInputSchema>;
