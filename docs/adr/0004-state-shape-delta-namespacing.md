# ADR-0004 — State shape: delta + namespacing, intake outside the graph

**Status:** Accepted
**Date:** 2026-05-04
**Deciders:** Raul Camacho

---

## Context

Slice 2 introduce el segundo state version del sistema (v1 producido por `identityAgent`). Antes de aterrizar el segundo agente, necesitamos resolver tres preguntas que afectan el shape de TODOS los agentes futuros:

1. ¿Cada row de `application_states` guarda **el FullState reconstruido** (cumulativo) o **solo lo que aporta este agente** (delta)?
2. ¿Los campos de cada agente conviven en un namespace plano (alto riesgo de colisiones — ej. `bureau.score` vs `altScore.score`) o cada agente namespacea bajo su nombre?
3. ¿`intake` es un nodo del grafo del orchestrator (con la misma signature que los demas agentes) o es algo estructuralmente distinto?

## Decision

### 1. Shape: delta + namespacing bajo `<agentName>`

**Cada row de `application_states.contribution` guarda solo el slice producido por ese agente, namespaced bajo su nombre. El FullState se reconstruye via `reduce` con spread.**

```
v0 contribution: { cedula, ingresos, monto, plazo }                    // intake: flat, datos primarios
v1 contribution: { identity: { name, birthDate, valid } }              // namespaced
v2 contribution: { income: { employer, salary, monthsActive } }
v3 contribution: { bureau: { score, history, hardInquiriesCount } }

FullState reconstruido (slice 6):
{
  cedula: '1712345678',
  ingresos: 1500,
  monto: 3000,
  plazo: 24,
  identity: { name: 'Maria Lopez', birthDate: '1990-04-12', valid: true },
  income: { employer: 'Empresa SA', salary: 1500, monthsActive: 36 },
  bureau: { score: 720, history: [...], hardInquiriesCount: 2 },
}
```

Excepcion documentada: **intake escribe flat** (sin namespace) porque sus 4 campos son los datos primarios crudos de la solicitud, no la contribucion de un agente.

### 2. `intake` es un Service, no un nodo del grafo

`intake` se renombra a `IntakeService` y vive en `src/services/intake/`, no en `src/agents/`. La API route hace:

```ts
// app/api/applications/route.ts
const { applicationId } = await intakeService.execute(body, ctx);  // crea v0
await orchestrator.run(applicationId, ctx);                         // arranca el grafo desde v0
```

El orchestrator nunca invoca a intake. El grafo arranca con state v0 ya persistido. El primer nodo del grafo es `identity` (slice 2), no `intake`.

`src/agents/` queda reservado SOLO para nodos del grafo.

### 3. Selector pattern: cada agente declara `selectInput`

El orchestrator es completamente generico. Cada agente declara su dependencia minima del FullState:

```ts
interface Agent<TInput, TOutput> {
  name: string;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;
  selectInput: (state: FullState) => TInput;
  execute: (input: TInput, ctx: ExecCtx) => Promise<TOutput>;
  compensate?: (input: TInput, ctx: ExecCtx) => Promise<void>;
}

// Orchestrator generico:
const state = await getLatestFullState(applicationId);
const input = agent.selectInput(state);
agent.inputSchema.parse(input);
const output = await agent.execute(input, ctx);
agent.outputSchema.parse(output);
await persistContribution(applicationId, version + 1, agent.name, { [agent.name]: output });
```

### 4. Sync orchestrator en slice 2

El orchestrator se invoca **sync dentro del POST request**. `await orchestrator.run(applicationId, ctx)` antes de devolver la response. Cuando la pipeline crezca (slices 6+ con RAG + LLM) y duracion total exceda timeouts razonables de HTTP, migramos a fire-and-forget + polling — pero eso es decision de slice 6.

### 5. Failure mode: state se queda en la ultima version exitosa

Si el orchestrator falla mientras corre `identity`, la application queda en v0. La UI muestra "v0 — pendiente / error". Resume/retry de pipelines fallidas es feature de slice 8+ y por ahora es deuda conocida documentada aqui.

## Rationale

### Por que delta + namespacing (vs cumulativo)

| Criterio | Cumulativo | Delta + namespacing |
|---|---|---|
| Storage | Pesado, JSONB duplicado en cada row | Lean — cada row es pure contribution |
| Audit "que produjo X agente" | Diff entre v_n y v_{n-1} | Trivial: leer v_n.contribution |
| Riesgo de overwrite accidental | ALTO — un agente puede pisar campos previos | NULO — namespacing previene colisiones |
| Lectura del estado actual | Trivial: latest version IS state | Necesita merge (cheap reduce) |

El factor decisivo fue **riesgo de overwrite**: con cumulativo, un agente buggy puede corromper datos previos por error. Con namespacing, dos agentes con campos llamados `score` (bureau, alt_score) coexisten sin colision: `merged.bureau.score` y `merged.altScore.score` son distintos.

### Por que intake fuera del grafo

Las alternativas para tratar intake como nodo del grafo eran:

- **Discriminated union** (`kind: 'first' | 'standard'`) — agrega complejidad al orchestrator.
- **State sintetico** (`__initialBody` con doble-underscore) — el prefix `__` esta literalmente diciendo "esto es especial, no me trates como state normal" → la abstraccion no es limpia, es forzada.

La verdad estructural es que intake **no transforma estado anterior en estado nuevo** — recibe un POST body, valida, persiste v0, devuelve `applicationId`. Eso es un factory, no un transformador. Forzarlo al patron de agentes-del-grafo esconde esta diferencia.

Beneficios de tratarlo como Service:
- Selector pattern queda completamente uniforme — cero excepciones, cero campos magicos.
- Si intake crece (idempotency check, validacion de cedula remota), no contamina al orchestrator.
- Test del orchestrator es trivial: solo necesita state v0 ya en DB, no un seeder de body sintetico.
- Encaja con el lenguaje natural: "el grafo empieza despues de intake".

Costo aceptado: dos terminos en el dominio en lugar de uno (`IntakeService` + agentes del grafo). Documentado en CONTEXT.md.

### Por que selector pattern

- **Modulo profundo (Pocock/Ousterhout):** el agente declara una API minima de 4-5 campos publicos (`name`, `inputSchema`, `outputSchema`, `selectInput`, `execute`, `compensate?`).
- **Orchestrator generico:** no conoce especificas de ningun agente, solo del contrato.
- **Type safety:** el TS compiler enforza que `selectInput` devuelva algo que matche `inputSchema`.
- **Testabilidad:** podes pasarle un FullState fake al `selectInput` sin pasar por el orchestrator.

### Por que sync en slice 2

Para slice 2 con un solo agente identity (mock con timeout 10s) + intake transaccional, sync es razonable. Migrar a async ahora seria over-engineering. El cuandico es claro: cuando la pipeline completa (slices 6+) supere 30s, refactor obligatorio.

El orchestrator emite eventos al tracer internamente — slice 8 (live graph visualizer) puede agregar un consumer SSE sin refactor del orchestrator.

## Consequences

### Positivas

- **Audit trail perfecto.** Cada row es la contribucion atomica de un agente. Para responder "que produjo identity" basta leer v1.contribution.
- **Imposible pisar.** El namespacing previene colisiones entre agentes con campos del mismo nombre.
- **Orchestrator generico.** Agregar un nuevo agente es escribir su archivo + agregarlo al grafo. No requiere cambios en el orchestrator core.
- **Deuda controlada.** Tres elecciones que arrastra esta decision (resume/retry, async orchestrator, breaker en UI) tienen slices asignadas.

### Negativas

- **Reconstruccion en cada lectura.** `getLatestFullState` hace un SELECT + reduce. Para 7-10 versions y JSONB pequenos, es nanosegundos. Si en el futuro el FullState pesa MB, considerar materialized view.
- **Excepcion `intake-flat`.** La regla "todos los agentes namespacean" tiene una excepcion. Documentada aqui y en CONTEXT.md, pero es una pequena tax cognitiva.
- **Failure mode primitivo.** Si el orchestrator falla, no hay resume — la application queda en su ultima version exitosa. Resume es slice 8+.

### Mitigacion

- `getLatestFullState` se centraliza en `src/db/repository.ts` — un solo lugar para optimizar si crece.
- La excepcion intake-flat esta documentada en CONTEXT.md (entrada `Estado (state)`) y en el codigo del `IntakeService`.
- El orchestrator emite eventos al tracer durante run — visible en console output cuando algo falla. UI muestra "v0 — pendiente" con timestamp.
