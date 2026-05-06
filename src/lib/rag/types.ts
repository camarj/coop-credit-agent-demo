/**
 * Domain types for the RAG corpus. Lives in a thin types module so
 * parser, retriever and policyAgent can share the same shape without
 * importing each other's internals.
 */

export type PolicyCategory = 'MIC' | 'GAR' | 'EXC' | 'SCO';

export interface PolicyChunk {
  ruleId: string; // 'MIC-001'
  category: PolicyCategory;
  title: string; // 'Tope para autonomos sin RUC'
  condicion: string; // 'solicitante sin afiliacion IESS, sin RUC activo'
  accion: string; // 'monto maximo USD 2,500, plazo maximo 36 meses'
  justificacion: string; // texto narrativo (NO entra al embedding text)
  tags: string[]; // kebab-case en el corpus; flatten en el embedding text
  /**
   * Bloque markdown crudo entre `---` (incluye titulo y todos los fields).
   * La UI lo muestra cuando el usuario hace click en una rule chip.
   */
  fullText: string;
}

export interface RetrievedChunk {
  chunk: PolicyChunk;
  score: number; // cosine similarity [0, 1]
}
