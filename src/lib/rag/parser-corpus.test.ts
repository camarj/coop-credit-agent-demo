import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parsePolicyCorpus, buildEmbeddingText } from './parser';

const corpusPath = path.resolve(
  process.cwd(),
  'docs/policy/cooperativa-policy.md',
);

describe('parsePolicyCorpus — real corpus integration', () => {
  it('parses the actual cooperativa-policy.md without errors', () => {
    const source = readFileSync(corpusPath, 'utf-8');
    const chunks = parsePolicyCorpus(source);

    expect(chunks.length).toBeGreaterThanOrEqual(12);

    const ids = new Set(chunks.map((c) => c.ruleId));
    expect(ids.size).toBe(chunks.length); // no duplicates

    // Categories represented per the slice 6 plan
    const categories = new Set(chunks.map((c) => c.category));
    expect(categories).toEqual(new Set(['MIC', 'GAR', 'EXC', 'SCO']));
  });

  it('every chunk has non-empty fields', () => {
    const source = readFileSync(corpusPath, 'utf-8');
    const chunks = parsePolicyCorpus(source);

    for (const chunk of chunks) {
      expect(chunk.title.length).toBeGreaterThan(5);
      expect(chunk.condicion.length).toBeGreaterThan(10);
      expect(chunk.accion.length).toBeGreaterThan(10);
      expect(chunk.justificacion.length).toBeGreaterThan(10);
      expect(chunk.tags.length).toBeGreaterThan(0);
    }
  });

  it('embedding text is well-formed for every chunk', () => {
    const source = readFileSync(corpusPath, 'utf-8');
    const chunks = parsePolicyCorpus(source);

    for (const chunk of chunks) {
      const text = buildEmbeddingText(chunk);
      expect(text).toContain(chunk.title);
      // No kebab-case tokens leaked into the embedding text
      expect(text).not.toContain('-iess');
      expect(text).not.toContain('-ruc');
      // No justificacion leaked in
      expect(text).not.toContain(chunk.justificacion);
    }
  });
});
