import { z } from 'zod';
import { PIPELINE_NODES } from '@/lib/orchestrator/pipeline';

const agentEnum = z.enum(PIPELINE_NODES);

const versionLiteral = z.literal(1).describe('schema version — clients reject events with version > 1');

const baseSpanFields = {
  version: versionLiteral,
  spanId: z.string().min(1).describe('unique id per span — stable across start/event/complete'),
  agent: agentEnum.describe('which pipeline node the span belongs to'),
  at: z.number().int().describe('server-side timestamp (ms since epoch)'),
} as const;

export const spanStartSchema = z
  .object({
    kind: z.literal('span.start'),
    ...baseSpanFields,
  })
  .describe('emitted when a span begins — moves node PENDING → RUNNING');

export const spanCompleteSchema = z
  .object({
    kind: z.literal('span.complete'),
    ...baseSpanFields,
  })
  .describe('emitted when a span ends successfully — moves node RUNNING → COMPLETE');

export const spanFailedSchema = z
  .object({
    kind: z.literal('span.failed'),
    ...baseSpanFields,
    reason: z.string().describe('error message from the failing agent'),
  })
  .describe('emitted when a span throws — moves node RUNNING → FAILED');

export const spanCompensatedSchema = z
  .object({
    kind: z.literal('span.compensated'),
    version: versionLiteral,
    spanId: z.string().min(1),
    agent: agentEnum,
    compensatedAt: z.number().int().describe('server-side timestamp of the compensation'),
    reason: z.string().describe('reason the saga walked back through this span'),
  })
  .describe('emitted during saga walk-back — moves node COMPLETE → COMPENSATED');

export const spanEventSchema = z
  .object({
    kind: z.literal('span.event'),
    ...baseSpanFields,
    name: z.string().min(1).describe('event name (e.g. "rules.retrieved", "llm.start")'),
    attrs: z.record(z.string(), z.unknown()).describe('event attributes (PII-redacted server-side)'),
  })
  .describe('emitted on span.addEvent — appended to nodes[agent].events[]');

export const spanAttributeSchema = z
  .object({
    kind: z.literal('span.attribute'),
    ...baseSpanFields,
    key: z.string().min(1),
    value: z.unknown(),
  })
  .describe('emitted on span.setAttribute — merged into nodes[agent].attributes');

export const orchestratorCompleteSchema = z
  .object({
    kind: z.literal('orchestrator.complete'),
    version: versionLiteral,
    at: z.number().int(),
  })
  .describe('terminal event — UI triggers router.refresh() to PersistedView');

export const orchestratorFailedSchema = z
  .object({
    kind: z.literal('orchestrator.failed'),
    version: versionLiteral,
    at: z.number().int(),
    reason: z.string(),
  })
  .describe('terminal event — UI shows error 2.5s then router.refresh()');

export const alreadyCompleteSchema = z
  .object({
    kind: z.literal('already_complete'),
    version: versionLiteral,
    at: z.number().int(),
  })
  .describe('emitted when client opens stream for an applicationId already terminated');

export const streamEventSchema = z.discriminatedUnion('kind', [
  spanStartSchema,
  spanCompleteSchema,
  spanFailedSchema,
  spanCompensatedSchema,
  spanEventSchema,
  spanAttributeSchema,
  orchestratorCompleteSchema,
  orchestratorFailedSchema,
  alreadyCompleteSchema,
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;
