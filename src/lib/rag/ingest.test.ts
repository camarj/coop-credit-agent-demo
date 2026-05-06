import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { db } from '@/db/client';
import { ragChunks } from '@/db/schema';
import { closeDb, resetRagChunks } from '@/db/test-helpers';
import { ingestCorpus } from './ingest';
import type { EmbedClient } from './embed-client';

const DIM = 1536;

function fakeVector(seed: number): number[] {
  return Array.from({ length: DIM }, (_, i) => ((i + seed) % 7) / 10);
}

const TWO_RULES = `# Politica

---

## Regla MIC-001 — Tope autonomos

**Aplica si:** solicitante autonomo.
**Accion:** monto maximo USD 2,500.
**Justificacion:** menor capacidad de pago.
**Tags:** autonomo, sin-iess

---

## Regla GAR-001 — Garante personal

**Aplica si:** monto mayor a USD 5,000.
**Accion:** requiere garante con score 700+.
**Justificacion:** cobertura adicional de riesgo.
**Tags:** garantia, monto-alto`;

beforeEach(async () => {
  await resetRagChunks();
});

afterAll(closeDb);

describe('ingestCorpus — happy path', () => {
  it('parses corpus, embeds each chunk, and inserts with rule metadata', async () => {
    const embedSpy = vi.fn().mockResolvedValue([fakeVector(0), fakeVector(1)]);
    const embedClient: EmbedClient = { embed: embedSpy };

    const result = await ingestCorpus({
      db,
      embedClient,
      source: TWO_RULES,
    });

    expect(result.inserted).toBe(2);

    // Embed called once with batch of 2 strings (titulo + cond + accion + tags-flatten).
    expect(embedSpy).toHaveBeenCalledOnce();
    const inputs = embedSpy.mock.calls[0][0] as string[];
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toContain('Tope autonomos');
    expect(inputs[0]).toContain('sin iess'); // kebab-case spliteado
    expect(inputs[0]).not.toContain('sin-iess');

    const rows = await db.select().from(ragChunks);
    expect(rows).toHaveLength(2);

    const mic = rows.find((r) => r.ruleId === 'MIC-001')!;
    expect(mic.category).toBe('MIC');
    expect(mic.title).toBe('Tope autonomos');
    expect(mic.fullText).toContain('## Regla MIC-001');
    expect((mic.metadata as { tags: string[] }).tags).toEqual([
      'autonomo',
      'sin-iess',
    ]);
  });

  it('TRUNCATEs before insert — second run replaces, not duplicates', async () => {
    const embedClient: EmbedClient = {
      embed: vi.fn().mockResolvedValue([fakeVector(0), fakeVector(1)]),
    };

    await ingestCorpus({ db, embedClient, source: TWO_RULES });
    await ingestCorpus({ db, embedClient, source: TWO_RULES });

    const rows = await db.select().from(ragChunks);
    expect(rows).toHaveLength(2); // not 4
  });
});

describe('ingestCorpus — failure modes', () => {
  it('throws if corpus has zero parseable rules', async () => {
    const embedClient: EmbedClient = { embed: vi.fn() };
    await expect(
      ingestCorpus({
        db,
        embedClient,
        source: '# Empty corpus\n\nNo rules here.',
      }),
    ).rejects.toThrow(/no rules/i);
    expect(embedClient.embed).not.toHaveBeenCalled();
  });

  it('propagates parser errors without writing to DB', async () => {
    const embedClient: EmbedClient = { embed: vi.fn() };
    const broken = `---\n\n## Regla MIC-099 — Bad\n\n**Aplica si:** x.\n**Justificacion:** z.\n**Tags:** a`; // missing Accion

    await expect(
      ingestCorpus({ db, embedClient, source: broken }),
    ).rejects.toThrow(/Accion/);

    const rows = await db.select().from(ragChunks);
    expect(rows).toHaveLength(0);
  });

  it('propagates embed errors without writing to DB', async () => {
    const embedClient: EmbedClient = {
      embed: vi.fn().mockRejectedValue(new Error('OpenAI 429')),
    };

    await expect(
      ingestCorpus({ db, embedClient, source: TWO_RULES }),
    ).rejects.toThrow(/OpenAI/);

    const rows = await db.select().from(ragChunks);
    expect(rows).toHaveLength(0);
  });
});
