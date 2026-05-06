import type { PolicyCategory, PolicyChunk } from './types';

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

const VALID_CATEGORIES: ReadonlySet<PolicyCategory> = new Set([
  'MIC',
  'GAR',
  'EXC',
  'SCO',
]);

const RULE_ID_PATTERN = /^([A-Z]{3})-\d{3}$/;
// Heading capture: anything after "Regla " up to "—", validated separately.
// A malformed ruleId still enters the parse path (so it errors loudly)
// instead of being skipped silently like prose without "Regla".
const HEADING_PATTERN = /^##\s+Regla\s+(\S+)\s+—\s+(.+)$/;

/**
 * Parses the policy corpus markdown into PolicyChunks. Each block between
 * `---` is a rule. Intro text before the first `---` (or blocks without a
 * `## Regla` heading) is skipped.
 *
 * Throws `ParseError` on any structural issue — missing fields, invalid
 * ruleId, unknown category, empty tags, or duplicate IDs. The corpus is
 * authored by humans, so failing fast at ingest time prevents bad data
 * from reaching pgvector or the LLM.
 */
export function parsePolicyCorpus(source: string): PolicyChunk[] {
  const blocks = source.split(/^---\s*$/m).map((b) => b.trim()).filter(Boolean);
  const chunks: PolicyChunk[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const headingLine = block.split('\n')[0]?.trim() ?? '';
    const headingMatch = HEADING_PATTERN.exec(headingLine);
    if (!headingMatch) continue;

    const [, ruleId, title] = headingMatch;

    if (!RULE_ID_PATTERN.test(ruleId)) {
      throw new ParseError(
        `Malformed ruleId "${ruleId}" — expected format CAT-NNN (e.g. MIC-001)`,
      );
    }

    const category = ruleId.split('-')[0] as PolicyCategory;
    if (!VALID_CATEGORIES.has(category)) {
      throw new ParseError(
        `Unknown category "${category}" in ruleId "${ruleId}". Valid: MIC, GAR, EXC, SCO`,
      );
    }

    const condicion = extractField(block, 'Aplica si', ruleId);
    const accion = extractField(block, 'Accion', ruleId);
    const justificacion = extractField(block, 'Justificacion', ruleId);
    const tagsRaw = extractField(block, 'Tags', ruleId);

    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (tags.length === 0) {
      throw new ParseError(
        `Rule ${ruleId} has empty tags list — at least one tag required`,
      );
    }

    if (seen.has(ruleId)) {
      throw new ParseError(`Duplicate ruleId "${ruleId}" found in corpus`);
    }
    seen.add(ruleId);

    chunks.push({
      ruleId,
      category,
      title: title.trim(),
      condicion,
      accion,
      justificacion,
      tags,
      fullText: block,
    });
  }

  return chunks;
}

function extractField(block: string, fieldName: string, ruleId: string): string {
  // Field lines look like: **Aplica si:** texto con varias lineas posibles.
  // Hasta el siguiente `**Field:**` o fin del bloque.
  const pattern = new RegExp(
    `\\*\\*${escapeRegex(fieldName)}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*[A-Za-z]|$)`,
  );
  const match = pattern.exec(block);
  if (!match) {
    throw new ParseError(
      `Rule ${ruleId} is missing the "${fieldName}" field`,
    );
  }
  return match[1].trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the text sent to the embedding model for a given chunk.
 *
 * Concatenates titulo + condicion + accion + tags-flatten. NOT included:
 * justificacion (narrative noise that does not appear in real queries),
 * ruleId (structural identifier, not lexical signal).
 *
 * Tags are kebab-case in the corpus but FLATTENED to space-separated
 * tokens here so the embedding picks up lexical match: queries like
 * "ingreso variable" should hit a chunk with tag "ingreso-variable".
 *
 * See ADR-0007 (section 4a) for the rationale.
 */
export function buildEmbeddingText(chunk: PolicyChunk): string {
  const tagsFlat = chunk.tags
    .map((t) => t.replace(/-/g, ' '))
    .join(' ');
  return [chunk.title, chunk.condicion, chunk.accion, tagsFlat].join(' ');
}
