import { describe, it, expect } from 'vitest';
import { parsePolicyCorpus, buildEmbeddingText, ParseError } from './parser';

const VALID_BLOCK = `## Regla MIC-001 — Tope para autonomos sin RUC

**Aplica si:** solicitante sin afiliacion vigente al IESS y sin RUC activo.
**Accion:** monto maximo USD 2,500. Plazo maximo 36 meses. Tasa diferencial autonomos.
**Justificacion:** menor capacidad de pago verificable; sin trazabilidad fiscal mitigamos exposicion limitando el ticket.
**Tags:** autonomo, sin-iess, sin-ruc, monto-bajo, microcredito`;

const TWO_BLOCKS = `# Politica de credito — Cooperativa Mock

> Texto introductorio que NO es una regla.

---

${VALID_BLOCK}

---

## Regla GAR-001 — Garante personal obligatorio sobre umbral

**Aplica si:** monto solicitado mayor a USD 5,000.
**Accion:** requiere garante personal con score Equifax mayor o igual a 700, antiguedad laboral igual o mayor a 24 meses, y carta de aval firmada.
**Justificacion:** ticket alto exige cobertura adicional de riesgo; el garante actua como respaldo en caso de default.
**Tags:** garantia, monto-alto, garante-personal, requisito-adicional`;

describe('parsePolicyCorpus — happy path', () => {
  it('parses a single rule block into a PolicyChunk', () => {
    const corpus = `# Header\n\n---\n\n${VALID_BLOCK}`;
    const chunks = parsePolicyCorpus(corpus);

    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    expect(chunk.ruleId).toBe('MIC-001');
    expect(chunk.category).toBe('MIC');
    expect(chunk.title).toBe('Tope para autonomos sin RUC');
    expect(chunk.condicion).toBe(
      'solicitante sin afiliacion vigente al IESS y sin RUC activo.',
    );
    expect(chunk.accion).toContain('USD 2,500');
    expect(chunk.justificacion).toContain('menor capacidad de pago');
    expect(chunk.tags).toEqual([
      'autonomo',
      'sin-iess',
      'sin-ruc',
      'monto-bajo',
      'microcredito',
    ]);
    expect(chunk.fullText).toContain('## Regla MIC-001');
  });

  it('parses multiple blocks separated by --- and skips intro text', () => {
    const chunks = parsePolicyCorpus(TWO_BLOCKS);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.ruleId)).toEqual(['MIC-001', 'GAR-001']);
    expect(chunks[1].category).toBe('GAR');
  });

  it('preserves the full markdown block in fullText for UI display', () => {
    const chunks = parsePolicyCorpus(`---\n\n${VALID_BLOCK}`);
    expect(chunks[0].fullText.trim()).toBe(VALID_BLOCK.trim());
  });
});

describe('parsePolicyCorpus — failure modes', () => {
  it('throws ParseError when a block is missing the Aplica si field', () => {
    const broken = `---\n\n## Regla MIC-099 — Broken\n\n**Accion:** algo.\n**Justificacion:** x.\n**Tags:** a, b`;
    expect(() => parsePolicyCorpus(broken)).toThrow(ParseError);
    expect(() => parsePolicyCorpus(broken)).toThrow(/MIC-099/);
    expect(() => parsePolicyCorpus(broken)).toThrow(/Aplica si/i);
  });

  it('throws ParseError when ruleId category is unknown', () => {
    const broken = `---\n\n## Regla XYZ-001 — Fake\n\n**Aplica si:** x.\n**Accion:** y.\n**Justificacion:** z.\n**Tags:** a`;
    expect(() => parsePolicyCorpus(broken)).toThrow(ParseError);
    expect(() => parsePolicyCorpus(broken)).toThrow(/XYZ/);
  });

  it('throws ParseError when ruleId format is malformed', () => {
    const broken = `---\n\n## Regla 001-MIC — Wrong order\n\n**Aplica si:** x.\n**Accion:** y.\n**Justificacion:** z.\n**Tags:** a`;
    expect(() => parsePolicyCorpus(broken)).toThrow(ParseError);
  });

  it('throws ParseError when tags list is empty', () => {
    const broken = `---\n\n## Regla MIC-099 — Empty tags\n\n**Aplica si:** x.\n**Accion:** y.\n**Justificacion:** z.\n**Tags:** `;
    expect(() => parsePolicyCorpus(broken)).toThrow(ParseError);
    expect(() => parsePolicyCorpus(broken)).toThrow(/tags/i);
  });

  it('throws ParseError when the same ruleId appears twice', () => {
    const dup = `---\n\n${VALID_BLOCK}\n\n---\n\n${VALID_BLOCK}`;
    expect(() => parsePolicyCorpus(dup)).toThrow(ParseError);
    expect(() => parsePolicyCorpus(dup)).toThrow(/duplicate/i);
  });
});

describe('buildEmbeddingText — tag flattening rule', () => {
  it('concatenates titulo + condicion + accion + tags spliteados en espacios', () => {
    const chunk = parsePolicyCorpus(`---\n\n${VALID_BLOCK}`)[0];
    const text = buildEmbeddingText(chunk);

    expect(text).toContain('Tope para autonomos sin RUC');
    expect(text).toContain('solicitante sin afiliacion');
    expect(text).toContain('USD 2,500');
    // kebab-case spliteado en espacios — los tokens individuales deben aparecer
    expect(text).toContain('sin iess');
    expect(text).toContain('sin ruc');
    expect(text).toContain('monto bajo');
    // NO debe contener el token kebab original (sin guion)
    expect(text).not.toContain('sin-iess');
    expect(text).not.toContain('sin-ruc');
  });

  it('does NOT include justificacion in the embedding text', () => {
    const chunk = parsePolicyCorpus(`---\n\n${VALID_BLOCK}`)[0];
    const text = buildEmbeddingText(chunk);
    expect(text).not.toContain('menor capacidad de pago verificable');
  });

  it('does NOT include the ruleId in the embedding text', () => {
    // Razon: el ruleId es identifier estructural, no senal lexica/semantica.
    // Si una query menciona "MIC-001" literalmente es lookup, no retrieval.
    const chunk = parsePolicyCorpus(`---\n\n${VALID_BLOCK}`)[0];
    const text = buildEmbeddingText(chunk);
    expect(text).not.toContain('MIC-001');
  });
});
