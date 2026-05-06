# ADR-0007 — RAG stack: LLM client, embeddings, policy corpus shape, retrieval strategy

**Status:** Accepted
**Date:** 2026-05-06
**Deciders:** Raul Camacho

---

## Context

Slice 6 introduce **la primera llamada real al LLM** del proyecto (`policyAgent`), y con ella el primer pipeline RAG: corpus de politica de credito sintetico → chunking → embeddings → pgvector → retrieve → LLM call con Zod-validated output.

Cuatro decisiones interdependientes que afectan al resto del proyecto y deben quedar resueltas en una sola pasada para no reabrirlas en cada slice de agente con LLM:

1. **Cliente LLM** — Vercel AI SDK vs Anthropic SDK directo (cerraba un open question heredado de ADR-0001).
2. **Embedding provider** — Voyage AI / Cohere / OpenAI / local.
3. **Shape del corpus de politica** — markdown editorial vs frontmatter estructurado vs JSON/YAML.
4. **Estrategia de retrieval** — que se embedea, top-K, rerank si/no.

Cerrarlas juntas porque son acopladas: el shape del corpus determina la estrategia de chunking, el chunking determina como se construye el embedding text, el embedding text determina la calidad del retrieval, y la calidad del retrieval determina si necesitamos rerank ya o como upgrade futuro.

## Decision

### 1. LLM client — `@anthropic-ai/sdk` directo (cierra open question de ADR-0001)

**Encapsulado** detras de un modulo propio `src/lib/llm.ts` con interfaz pequena (un metodo `generate({ system, messages, model, maxTokens, ... })`). El wrapper anida `withCircuitBreaker` para fallback intra-proveedor.

**Por que.**

- **Multi-provider switching no aplica.** La unica venta real de Vercel AI SDK es cambiar de provider sin tocar el agente. Una cooperativa regulada NO rota providers — el caso de estudio se ancla a Claude.
- **La UI no es chat.** `useChat`/`streamText` de Vercel AI SDK son zero valor — el demo es pipeline deterministica con LLM en dos puntos (policy, decision), no un chat token-stream.
- **Acceso directo a features avanzadas de Claude** sin esperar a un wrapper que las porte: prompt caching para system prompts del RAG (critico — el system prompt + reglas no cambian entre calls), betas de Anthropic, control fino sobre `stop_sequences` / `temperature`.
- **Coherencia narrativa del demo.** Cuando explicas en webinar "este es el prompt que se manda a Claude", el codigo mostrado debe ser el SDK literal, no un wrapper multi-provider.
- **Costo de cambio aceptable.** Si en 6 meses hay razon real para multi-provider, el modulo `llm.ts` aislado se cambia en un dia.

**Estrategia de fallback: graceful degradation intra-proveedor con circuit breaker.**

`src/lib/llm.ts` envuelve el call a Claude con el mismo `withCircuitBreaker(fn, opts)` que envuelve los mocks externos. Cuando el breaker se abre con el modelo primary (`claude-sonnet-4-6`), el retry baja a `claude-haiku-4-5-20251001` para mantener el demo vivo con confidence menor. Sin fallback inter-proveedor (no se cae a OpenAI/Bedrock).

**Que NO se decidio aqui:** si meter LangGraph o seguir con el orchestrator custom propio. Hoy el orchestrator (`src/orchestrator/index.ts`) cubre serial + paralelo + saga sin friccion. LangGraph se evalua cuando llegue branching condicional (slice del `decisionAgent`) — no antes.

### 2. Embedding provider — OpenAI `text-embedding-3-small` (1536 dims, sin reducir)

**Por que.**

- **Una API key menos para gestionar** que Voyage AI o Cohere — Raul ya tiene OpenAI key configurada en su stack habitual.
- **Madurez y precio.** $0.02/1M tokens es ~3x mas barato que Voyage. Para el corpus completo (~15 reglas × ~150 tokens = 2.5K tokens), el costo es centavos de centavos.
- **Calidad en español aceptable.** El corpus es vocabulario financiero estandar y queries del estilo "soy autonomo, cuanto puedo pedir" — no es prosa literaria que requiera un modelo multilingue dedicado.
- **Dimension manejable.** 1536 dims en pgvector con HNSW index funciona perfecto. Reducir via `dimensions` param solo se justifica si el storage es restriccion real (no lo es).

**NO `text-embedding-ada-002`** — legacy, deprecated por OpenAI desde inicios de 2024 a favor de la familia `-3-`. Si en algun pitch un prospect pregunta por que OpenAI siendo el LLM Anthropic, la respuesta es: **"embeddings y completions son trabajos distintos. OpenAI tiene la API de embeddings mas madura y barata; Claude es el mejor en razonamiento. Mezclar best-of-breed por capa es produccion real, no marketing de stack unico."**

### 3. Shape del corpus — markdown con frontmatter por regla, IDs `MIC-XXX` / `GAR-XXX` / `EXC-XXX`

`docs/policy/cooperativa-policy.md` es **un solo archivo** con bloques separados por `---`. Cada bloque es una regla autocontenida con shape:

```markdown
## Regla MIC-001 — Tope para autonomos sin RUC

**Aplica si:** solicitante sin afiliacion IESS, sin RUC activo
**Monto maximo:** USD 2,500
**Plazo maximo:** 36 meses
**Justificacion:** menor capacidad de pago verificable; mitigamos exposicion.
**Tags:** autonomo, sin-iess, sin-ruc, monto-bajo

---
```

**Namespacing de IDs por categoria:**
- `MIC-XXX` — montos y plazos de microcredito
- `GAR-XXX` — garantias y avales
- `EXC-XXX` — exclusiones (edad, fallecidos, etc.)
- `SCO-XXX` — score minimo / debt-to-income

Minimo **12 reglas** que cubran: tope por afiliacion (autonomo / IESS), tope por score (>=650, >=700), garantias para montos altos, antiguedad laboral minima, debt-to-income maximo, exclusion de fallecidos, exclusion por edad fuera de rango, RUC activo como compensador de no-IESS.

**Por que markdown frontmatter y NO markdown editorial puro NI JSON/YAML.**

- **AC literal del issue #6** pide *"cada una con ID, condicion en lenguaje natural, accion sugerida"* — encaja directo.
- **Cada regla es un chunk natural.** Sin sliding window, sin overlap, sin tunear tamanos. La unidad de retrieval coincide con la unidad de regla.
- **UI puede citar `MIC-001` como chip estable** — mucho mas limpio que snippet de prosa con highlights de offsets.
- **Task del LLM mas limpio.** "Devolveme cuales de estas 5 reglas aplican" >>> "extrae estructura de prosa para decidir aplicabilidad".
- **Sigue siendo realista.** Las cooperativas modernas escriben politicas asi (manuales con codigos `MIC-XXX`).

**NO opcion C (JSON/YAML):** elimina el RAG. Si el LLM puede consultar tabla estructurada, no hay retrieval semantico — es lookup. Defeats el proposito de la slice.

### 4. Estrategia de retrieval — K=5, embedding text limpio, rerank trivial

**4a. Que se embedea (texto enviado a OpenAI por chunk):**

```
<titulo> <condicion-en-prosa> <accion-en-prosa> <tags-flatten>
```

**Tags flatten regla dura:** los tags vienen kebab-case en el frontmatter (`autonomo, sin-iess, monto-bajo`) pero al embedear se concatenan **spliteados en espacios y limpios de puntuacion**:

```
[autonomo, ingreso-variable, alto-riesgo]   ← NO mandar asi (corchetes/comas/comillas en el embedding)
"autonomo ingreso-variable alto-riesgo"      ← NO mandar asi (kebab-case oculta tokens)
"autonomo ingreso variable alto riesgo"      ← SI: tokens lexicos limpios
```

Esto le da match lexico al embedding ademas del semantico — las queries reales de prospects/usuarios dicen "ingreso variable", no "ingreso-variable".

**Justificacion NO se incluye en el embedding text.** Es texto narrativo que no aparece en queries reales y agrega ruido. Se persiste en `metadata` para mostrar en UI cuando una regla aplica, pero no entra al vector.

**4b. Top-K = 5.**

Con corpus de 12-15 reglas, K=5 recupera 33-40% del corpus — suficiente contexto para que el LLM decida sin saturarse, y agresivo suficiente para ejercitar el retrieval (vs K=8 que se acerca al 60% del corpus y desdibuja el RAG).

**4c. Rerank — interfaz publica presente, implementacion trivial.**

`RAGRetriever.rerank(chunks, query, topN?)` existe como metodo publico (cumple AC del issue #6) y hoy hace **sort estable por score + dedupe por `rule_id` + optional cap a `topN`**. NO usa Cohere Rerank ni LLM rerank.

**Dedupe por `rule_id`, NO por hash del contenido.** Hoy es trivial porque cada regla es 1 chunk; la regla dura previene fallo silencioso el dia que el corpus crezca y aparezca una regla larga chunked en condicion + accion separadas. Comentario obligatorio en el codigo:

```ts
// Dedupe por rule_id, no por contenido. Hoy es trivial (1 chunk por regla);
// este invariante se mantiene cuando el corpus crezca y aparezcan reglas
// multi-chunk porque su body excede el max_tokens del embedding model.
```

**Por que no rerank "real" hoy.**

- **Corpus muy chico.** Diferencia entre vector retrieval directo y cross-encoder es marginal con 15 reglas — el gap se nota en corpus 10K+, no aqui.
- **Cohere Rerank introduce dependencia narrativa adicional** (otro provider, otra API key) para ganancia marginal.
- **LLM rerank duplica latencia + costo** y mete dos LLM calls en serie — contradiciendo el espiritu de paralelismo del orchestrator (ADR-0006).
- **Interfaz publica aguanta el upgrade.** El dia que el eval real diga "precision@K pobre con K balanceado", swap del cuerpo de `rerank` sin tocar callers (Ousterhout deep module).

### 5. Pipeline de ingest — `pnpm rag:ingest` standalone

Script en `scripts/rag-ingest.ts` que:

1. Parsea `docs/policy/cooperativa-policy.md` extrayendo bloques entre `---`.
2. Por cada bloque, parsea frontmatter custom (titulo + Aplica si + Monto/accion + Justificacion + Tags) → `PolicyChunk { ruleId, title, condicion, accion, justificacion, tags }`.
3. Construye el `embeddingText` segun regla 4a.
4. Llama OpenAI embeddings batch (1 sola request para todos los chunks — son 15).
5. Persiste en tabla `rag_chunks(id, rule_id, title, full_text, embedding vector(1536), metadata jsonb, created_at)`.
6. Idempotente: `TRUNCATE rag_chunks` antes de insertar (corpus completo se reemplaza, no merge).

Migration drizzle nueva: `rag_chunks` con `embedding vector(1536)` + index HNSW sobre `embedding`. Pgvector ya esta provisionado (docker-compose `pgvector/pgvector:pg16`).

## Disparadores de upgrade futuro

**Esta tabla es la razon principal del ADR.** El proximo que toque retrieval (incluido el yo de slice 9) sabe en que orden escalar sin reabrir esta conversacion.

| Decision actual | Disparador para upgrade |
|---|---|
| `K = 5` | `recall@5 < 1.0` sobre eval set → subir a `K=6`. Si persiste, mover embedding model antes que K=8. |
| Rerank trivial (sort + dedupe) | `precision@K` pobre con K balanceado → LLM rerank si latencia alcanza, sino Cohere Rerank API. |
| Embedding text = `titulo + cond + accion + tags` | Si recall pobre persiste con K subido → agregar `justificacion` solo si las queries reales del usuario usan ese vocabulario (medirlo). |
| Embedding model `text-embedding-3-small` (1536) | Si `recall < 0.95` con K=8 → probar `text-embedding-3-large` o multilingual dedicado (Cohere `embed-multilingual-v3`). |
| Cliente LLM Anthropic SDK directo | Si aparece requerimiento real de multi-provider (no hipotetico) → migrar `llm.ts` a Vercel AI SDK. Costo: 1 dia. |

**Recall@K es la metrica accionable para mover K.** Precision@K con corpus de 15 reglas y K=5 va a estar 0.6-0.8 inevitable — no es metrica para mover K, es metrica para mover rerank/embedding model.

## Consequences

### Positivas

- **Stack consistente con el espiritu del demo.** Anthropic SDK directo (no abstraccion de mas), pgvector ya provisionado, OpenAI embeddings via API key existente.
- **Corpus auditable y citable.** Reglas con ID estable se citan en UI sin offsets de chunk.
- **Costo casi cero.** Ingest completo cuesta centavos de centavos. Cada policy call al LLM ~$0.005 con Sonnet, ~$0.0005 con Haiku.
- **Interfaz `RAGRetriever` aguanta upgrades** sin tocar callers. Cohere rerank, embedding model swap, K bump — todo absorbe.
- **Open question de ADR-0001 cerrado.** El proximo agente con LLM (decisionAgent) consume el mismo `llm.ts` sin reabrir el debate.

### Negativas

- **Dependencia narrativa pequena con OpenAI.** Si un prospect insiste en "todo Anthropic", la respuesta lista esta arriba.
- **Eval set pendiente.** Sin queries de prueba con ground truth, no se puede medir recall@K. La construccion del eval set es responsabilidad de slice 6 — minimo 10 queries con reglas esperadas.
- **No hay rerank real.** Si el demo se pone delante de un prospect tecnico que pregunta "como reankeas", la respuesta es la del caveat de senior — defendible.
- **Graceful degradation Sonnet → Haiku exige tracking de cual modelo respondio.** El span del LLM call debe incluir `model.actual` ademas de `model.requested` para que la UI muestre cuando degradacion ocurrio.

## Alternatives considered

- **Vercel AI SDK con multi-provider switching.** Rechazado: zero valor real para este demo. Costo de cambio bajo si aparece requerimiento real.
- **Voyage AI embeddings.** Rechazado en favor de OpenAI por cuestion de gestion de API keys + precio. Calidad seria comparable.
- **Cohere embed-multilingual-v3.** Rechazado por mismo motivo (otra API key) + corpus es financiero estandar, no requiere multilingual dedicado.
- **Local embeddings (`@xenova/transformers`).** Rechazado: 500MB de bundle, cold start serverless 3-5s, deuda tecnica para ahorrar centavos.
- **Markdown editorial puro.** Rechazado: obliga a sliding window + overlap, citacion por offset feo, doble trabajo del LLM.
- **JSON/YAML estructurado.** Rechazado: defeats el RAG, es lookup de tabla.
- **Cohere Rerank upfront.** Rechazado: ganancia marginal con corpus de 15 reglas, otra dependencia.

## Notes

- `src/lib/llm.ts` y `src/lib/rag/` son nuevos. La interfaz publica del retriever se valida con Raul **antes** del TDD (firma propuesta abajo).
- El eval set vive en `tests/rag-eval/queries.json` — fuera del runtime, dentro de los tests para regresion automatica.
- Si llega slice de evals formales con dataset grande (Langfuse Datasets), esta tabla de upgrade triggers se mueve alla.
