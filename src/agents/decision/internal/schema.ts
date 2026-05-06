import { z } from 'zod';

/**
 * Schemas Zod del decisionAgent. La discriminated union de output forza la
 * invariante regulatoria: hard_reject y llm_decision tienen shapes distintos
 * y un caller no puede confundirlos. Ver ADR-0008 secciones 4 y 8.
 */

// Cita de regla con prefijo MIC/GAR/EXC/SCO + 3 digitos. Espejo del corpus.
const ruleIdSchema = z
  .string()
  .regex(/^(MIC|GAR|EXC|SCO)-\d{3}$/, 'rule id must match CAT-NNN');

// Input shape — mirror de la slice de FullState que el agente consume.
export const decisionInputSchema = z.object({
  cedula: z.string().regex(/^\d{10}$/),
  ingresos: z.number().nonnegative(),
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
      history: z
        .array(z.object({ at: z.number(), source: z.string() }))
        .optional(),
    })
    .optional(),
  alt_score: z
    .object({
      score: z.number(),
      signals: z.array(z.string()),
    })
    .optional(),
  policy: z
    .object({
      applies: z.array(ruleIdSchema),
      notes: z.string(),
    })
    .optional(),
});

export type DecisionInput = z.infer<typeof decisionInputSchema>;

// Source de campos autoritativos. 'form_input' NO aparece — vetado por
// construccion: hard rejects no pueden disparar desde datos auto-declarados.
const authoritativeSourceSchema = z.enum([
  'registro_civil',
  'iess',
  'bureau',
  'derived',
]);

// Hard reject variant — siempre desde preDecide().
const hardRejectSchema = z.object({
  decision: z.literal('REJECTED'),
  decisionType: z.literal('hard_reject'),
  // Hard rejects son deterministicos — no hay incertidumbre estadistica
  // que comunicar. Confidence siempre 1.0.
  confidence: z.literal(1),
  llmBypassed: z.literal(true),
  triggeredBy: z.object({
    field: z.string(),
    source: authoritativeSourceSchema,
    value: z.unknown(),
    computed: z.record(z.string(), z.unknown()).optional(),
  }),
  citedRules: z.array(ruleIdSchema).length(1), // siempre 1: el EXC que disparo
  reason: z.string(),
});

// LLM decision variant — desde computeConfidence + LLM redactor.
const signalContributionSchema = z.object({
  signal: z.string(),
  weight: z.number(),
  rawValue: z.number().nullable(),
  contribution: z.number(),
  weighted: z.number(),
});

const llmDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REVIEW']),
  decisionType: z.literal('llm_decision'),
  confidence: z.number().min(0).max(1),
  llmBypassed: z.literal(false),
  breakdown: z.array(signalContributionSchema),
  // Reason del LLM: max 500 chars validado en Zod (defensa correctiva).
  // Defensa preventiva: max_tokens=200 en el LLM call (~500 chars).
  // Si excede, el agente cae a canned reason por bucket y marca degraded:true.
  // Ver ADR-0008 seccion 8 — "max_tokens vs reason ≤ 500 chars".
  reason: z.string().min(1).max(500),
  citedRules: z.array(ruleIdSchema), // subset de policy.applies, validado en agent
  modelRequested: z.string(),
  modelActual: z.string(),
  degraded: z.boolean(),
});

export const decisionOutputSchema = z.discriminatedUnion('decisionType', [
  hardRejectSchema,
  llmDecisionSchema,
]);

export type DecisionOutput = z.infer<typeof decisionOutputSchema>;
export type HardRejectOutput = z.infer<typeof hardRejectSchema>;
export type LlmDecisionOutput = z.infer<typeof llmDecisionSchema>;

/**
 * Schema del JSON crudo que el LLM produce. Despues de parsing, el agent
 * valida `citedRules ⊆ policy.applies` (esa validacion no vive en el schema
 * porque depende del state runtime, no del shape estatico).
 */
export const llmRawOutputSchema = z.object({
  reason: z.string().min(1).max(500),
  citedRules: z.array(ruleIdSchema),
});

export type LlmRawOutput = z.infer<typeof llmRawOutputSchema>;
