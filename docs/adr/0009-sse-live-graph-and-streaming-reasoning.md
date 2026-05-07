# ADR-0009 — Live graph visualizer + streaming reasoning via SSE

**Status:** Accepted
**Date:** 2026-05-07
**Deciders:** Raul Camacho

---

## Context

Slice 8 introduce **el primer canal en tiempo real** del demo: la UI deja de mostrar paneles `v0..v6` post-mortem y pasa a mostrar el grafo de agentes ejecutandose en vivo, con el razonamiento de cada uno apareciendo a medida que sucede.

El producto cambia de "ves el resultado del pipeline" a "**watch the agent think**". Esa es toda la narrativa del webinar/pitch: el oficial de credito no recibe una caja negra que escupe `APPROVED`, ve a cada agente verificar identidad, calcular DTI, consultar buro, citar reglas de la politica.

Cinco decisiones interdependientes que se cierran juntas porque ninguna funciona aislada:

1. **Transporte** — SSE vs WebSockets vs polling; flow del lifecycle (V1 vs V2 vs V3); que pasa con back-pressure.
2. **Que se emite** — lifecycle solo (Nivel A) vs lifecycle + addEvents + attributes (Nivel B) vs LLM tokens (Nivel C); como se controla PII.
3. **Como se reduce el stream a estado** — reducer puro testeable vs setState ad-hoc en componentes; donde vive el indice; como modelar `COMPENSATED`.
4. **Como se renderiza el grafo** — React Flow vs SVG manual vs cards lineales; donde van animaciones y a11y.
5. **Que ve el usuario al refrescar** — replay del stream vs paneles estaticos vs split de modos; como se coordina con orchestrator (saga walk-back).

Slice arquitectonicamente mas simple que slice 7 (no hay decisiones regulatorias) pero mas rica en decisiones de UX/transport. El grilling pre-implementacion en `coop-credit/slice-8/grilling-completo` (memoria #316) cubrio las 5.

---

## Decision

### 1. Transporte: SSE + BroadcastTracer + flow V1

**SSE sobre WebSockets sobre polling.** El stream es server→client unidireccional (cliente nunca habla durante la ejecucion del agente). SSE es HTTP plano, atraviesa proxies/Cloudflare/Vercel sin handshake especial, reconecta automatico via `EventSource`, no necesita libreria. WebSockets aporta cero valor para este caso y suma operacional (sticky sessions, upgrade).

**Flow V1 — POST solo intake, GET stream corre orchestrator.** Tres variantes consideradas:

| Variante | POST `/api/applications` | GET `/api/applications/[id]/stream` |
|---|---|---|
| **V1 (elegida)** | Persiste solo v0 (intake) | Corre orchestrator dentro del lifecycle del stream |
| V2 dual run | Dispara orchestrator | Reconstruye stream replay |
| V3 replay | Dispara orchestrator | Lee `application_events` y replay |

V1 es **single source of truth**: el orchestrator se ejecuta una sola vez, dentro del `ReadableStream` del GET. V2 es bug latente (dos ejecuciones concurrentes del mismo flow). V3 es over-engineering para slice 8 — la tabla de eventos no existe todavia y la deuda de replay vive en slice 9+.

**BroadcastTracer adapter del Tracer existente** (`src/lib/tracer/index.ts`). El `Tracer` actual ya expone `span(name, attrs, fn)` con `Span.setAttribute` / `Span.addEvent`. El nuevo `BroadcastTracer` envuelve esa misma interfaz y emite cada operacion como frame SSE. **Cero cambio en agentes** — siguen llamando `span.addEvent('rules.retrieved', { count: 4 })` exactamente como hoy.

**Back-pressure: drop silencioso.** Cuando `controller.desiredSize <= 0` (cliente lento o desconectado), el frame se descarta. Sin buffer infinito, sin block del orchestrator, sin error. La consistencia de estado vive en Postgres — el stream es proyeccion en vivo, no fuente de verdad.

**Error handling.** Error event SSE + abort listener en route handler. Si `req.signal.aborted` se dispara (cliente cierra tab), el stream se cierra. AbortSignal cross-cutting hasta el orchestrator queda como deuda slice 9+ (hoy el orchestrator sigue corriendo y persistiendo aunque el cliente se haya ido — costo aceptable, los mocks son rapidos).

**Last-Event-ID NO soportado en slice 8** — decision explicita, no omision. Si el cliente pierde la conexion durante el stream activo, **el gap de eventos entre desconexion y reconexion se pierde definitivamente**. `EventSource` reintenta automaticamente pero el server arranca emitiendo desde el evento corriente, no desde donde se corto. Replay completo requiere tabla `application_events` que no existe — deuda slice 9+. Mitigacion en slice 8: si el flow ya termino (decision o saga persistida), `event: already_complete` dispara `router.refresh()` y el cliente cae a `<PersistedView>` con la verdad completa de Postgres.

**Vercel timeout caveat.** Hobby tier corta a 10s — riesgo si el pipeline completo (incluyendo dos LLM calls de policy + decision) supera ese limite. Pro tier sube a 60s. Demo en local y deploy en Pro: ok. Documentado para evitar sorpresa post-deploy.

### 2. Eventos Nivel B: lifecycle + addEvents + attributes

**Tres niveles considerados:**

| Nivel | Que emite | Decision |
|---|---|---|
| A | Solo lifecycle (`span.start` / `span.end`) | Insuficiente — no muestra pensamiento |
| **B (elegida)** | A + cada `addEvent` + cada `setAttribute` | Aprovecha lo que los agentes ya emiten |
| C | B + tokens LLM streaming | Over-scope para slice 8 |

**Aprovecha `addEvent` existentes.** Los agentes de slice 6/7 ya llaman `span.addEvent('rules.retrieved', { count, ruleIds })`, `span.addEvent('llm.start')`, `span.addEvent('llm.completed', { tokens })`. Cero cambio de codigo en agentes — el adapter los emite como frames SSE.

**Server emite todo, cliente filtra.** No hay allowlist server-side de que eventos pasan. El cliente decide que renderizar (algunos eventos van al panel de razonamiento, otros solo actualizan estado del nodo). Filtrar en server fragmenta la fuente de verdad y obliga a coordinacion cuando se agrega un evento nuevo.

**Cada `setAttribute` emite evento separado.** Mas fiel a la narrativa "watch it happen": ver `dti = 0.42` aparecer en el panel justo cuando el agente lo calcula es mas potente que ver `attributes: {...}` en bloque al final del span.

**PII denylist en server (CRITICO — requisito regulatorio EC).** El demo apunta a cooperativas reguladas por la **Superintendencia de Economia Popular y Solidaria (SEPS)** y sujetas a la **Ley Organica de Proteccion de Datos Personales del Ecuador (LOPDP, vigente desde 2022)**. Toda transmision de PII (cedula, datos financieros) sin redaccion explicita es violacion regulatoria documentada — y aunque el demo no procese datos reales, la postura tecnica debe ser apta para produccion regulada desde dia 1. Antes de serializar cualquier frame, el `BroadcastTracer` redacta keys sensibles:

```ts
const SENSITIVE_KEYS = new Set([
  'cedula', 'password', 'token', 'secret',
  'apikey', 'authorization', 'cookie', 'creditcard', 'cvv',
]);
// match case-insensitive en cualquier nivel del attrs object (deep walk)
```

Si un agente accidentalmente hace `span.setAttribute('cedula', '0915123456')`, el cliente recibe `{ cedula: '[REDACTED]' }`. **Tests obligatorios** verifican el redaction antes de mergear (gate del TDD). La denylist es **server-side y unilateral** — no hay opt-out via parametro, no hay logging del valor original. Para slice 9+: tokenizacion (hash determinista por sesion) si auditoria requiere correlacion sin exposicion.

**Zod schema compartido server+cliente** en `src/lib/streaming/event-schema.ts`. Server hace `.parse()` antes de `controller.enqueue`, cliente hace `.safeParse()` y descarta invalidos (defensive, evita romper UI por evento malformado de version futura). Single source of truth para el shape.

**`version: 1` en cada evento.** Permite degradacion gracil cuando agreguemos campos en slice 9+ — clientes viejos rechazan eventos `version: 2` sin romper.

**`spanId` unico por span (no solo `spanName`).** Identificador estable para correlacionar inicio/fin/eventos cuando haya retries intra-flow o paralelos del mismo agente. `bureau_v3` puede aparecer dos veces si retry se permite — sin `spanId` el reducer no puede distinguir.

**`at` server-side timestamp.** Audit-friendly. Cliente calcula elapsed con `Date.now()` propio (no confia en clock skew del server para UI).

### 3. Reducer puro indexado por agent + 3 sub-decisiones

**Reducer puro vs setState ad-hoc.** Funcion pura `reduce(prev: GraphState, event: Event): GraphState` testeable sin DOM, sin EventSource, sin DB. Predecible, debuggeable con replay de array de eventos en test.

**Indexacion por `agent` (no por `spanId`)** porque hoy ningun agente tiene retry intra-flow. El nodo guarda `currentSpanId` adentro para correlacion de eventos. **Caveat documentado en codigo:** refactor a `Record<spanId, NodeState>` cuando aparezca el primer agente con retry intra-flow (probablemente cuando llegue tool-use de Anthropic en slice 11+).

**Estado inicial estatico — 6 nodos PENDING desde constante compartida.** **Server y cliente importan desde el mismo archivo:** `src/lib/orchestrator/pipeline.ts` exporta `PIPELINE_NODES`, y tanto el route handler (`/api/applications/[id]/stream`) como el componente `<GraphVisualizer>` (cliente) hacen `import { PIPELINE_NODES } from '@/lib/orchestrator/pipeline'`. **Cero duplicacion**: hardcodear `['identity', 'income', ...]` en el cliente esta prohibido — code review rechaza. Si slice futura agrega un agente al pipeline, modificar `PIPELINE_NODES` en un solo archivo actualiza grafo, reducer inicial y orchestrator simultaneamente.

```ts
// src/lib/orchestrator/pipeline.ts — SINGLE SOURCE OF TRUTH
export const PIPELINE_NODES = [
  'identity', 'income', 'bureau', 'alt_score', 'policy', 'decision',
] as const;

export type AgentName = typeof PIPELINE_NODES[number];
```

El archivo NO importa nada del orchestrator runtime (mantiene zero deps para que el cliente lo pueda importar sin pulling-in de Postgres/Drizzle).

**Hook `useGraphStream(applicationId)`** encapsula `EventSource` + `useReducer` + cleanup. Componentes solo consumen `{ state, status }`. Sin acoplamiento entre vista y transporte.

**`COMPENSATED` en NodeState** (cubre hueco critico del grilling):

```ts
type NodeState = 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED' | 'COMPENSATED';
```

`COMPENSATED` aparece cuando saga walk-back deshace un agente exitoso. Visualmente: nodo amarillo/grayed con icono de undo. **Coordinacion con slice 5 obligatoria** (ver seccion "Cross-cutting con orchestrator" abajo).

### 4. SVG manual con animaciones CSS + 6 adiciones

**Tres opciones consideradas:**

| Opcion | Bundle | Pros | Cons |
|---|---|---|---|
| React Flow | ~200KB | Drag, zoom, mini-map | Overkill — el grafo es estatico, no editable |
| Cards lineales | 0 | Simple | Lineas paralelas frágiles, sin fan-out claro del paralelo bureau/alt_score |
| **SVG manual** | ~3KB | Control total, SSR-friendly | Hay que escribir el path |

**SVG manual.** 3KB cero deps. Control total sobre tokens del design system v2 (stroke `var(--rule-strong)`, fill `var(--bg-elevated)`, accent `var(--accent)` solo para nodo activo). SSR-friendly — el grafo en estado final estatico para `PersistedView` se renderiza en server component sin hidratacion.

**Layout fan-out paralelo.** Bureau arriba / alt_score abajo, conectados con curvas Bezier que convergen en "Y" antes de policy. Replica visualmente la estructura del paralelo del orchestrator (ADR-0006).

```
identity → income →┬→ bureau    ─┐
                   └→ alt_score ─┴→ policy → decision
```

**`<ReasoningPanel>` slide-in solo cuando hay seleccion.** No persistente — no roba espacio cuando el usuario quiere ver el grafo completo. Drawer mobile (slide desde abajo). Cierre con click fuera o Escape.

**`prefers-reduced-motion` desde slice 8** (no slice 11). A11y standard, no se posterga. Animaciones CSS respetan `@media (prefers-reduced-motion: reduce)`.

**6 adiciones de UX:**

1. **Error connection banner con retry.** Si `EventSource.onerror` se dispara, banner sticky arriba con boton "Reconectar". Sin auto-reconnect en slice 8 (deuda slice 9+).
2. **Selected node ring 2px `var(--accent)`.** Indicador visual claro de que nodo esta abierto en el panel.
3. **Hover state + cursor pointer.** Feedback de que los nodos son clickeables.
4. **Keyboard navigation + focus-visible ring.** Tab entre nodos, Enter/Space abre panel. A11y.
5. **Labels español.** "Identidad / Ingresos / Buró / Score Alt. / Política / Decisión". El tracer-bullet usa nombres en ingles internos (`identity`, `bureau`...) pero la UI es 100% español por design system v2.
6. **`NODE_POSITIONS` extraido a constante.** No magic numbers en JSX. Permite reposicionar de un solo lugar cuando algun layout responsive lo requiera.

**Validar contraste edge PENDING en mobile.** Si `var(--rule)` queda muy claro contra ivory en pantallas pequenas, subir a `var(--fg-muted)` con opacity. Test visual obligatorio en viewport 375px.

### 5. Live-mode vs persisted-mode al refresh

**`deriveMode(states)` puro.** Funcion sincrona que mira los states v0..vN persistidos y decide:

```ts
function deriveMode(states: ApplicationState[]): 'live' | 'persisted' {
  const hasDecision = states.some(s => s.createdByAgent === 'decision');
  const hasSagaRow = states.some(s => s.payload?.type === 'saga');
  return (hasDecision || hasSagaRow) ? 'persisted' : 'live';
}
```

**Caveat slice 9 (preventivo):** usar `payload.type === 'saga'` en lugar de `createdByAgent === 'orchestrator'`. Slice 9 va a introducir `token_budget_exceeded` que tambien sera persistido por el orchestrator pero NO es saga — el discriminator por payload type evita futuro refactor.

**Live mode:** client component `<LiveView>` con `useGraphStream`. Conexion SSE activa, grafo animado, panel de razonamiento.

**Persisted mode:** server component `<PersistedView>` con paneles v0..v6 + grafo en estado final estatico (sin animaciones, sin EventSource). Refresh idempotente — recargar la pagina N veces da el mismo resultado.

**Distinguir `orchestrator.complete` vs `orchestrator.failed`:**

- `orchestrator.complete` → `router.refresh()` inmediato. La proxima render es `<PersistedView>` con la decision final.
- `orchestrator.failed` → mostrar error visible 2.5s, despues `router.refresh()`. La proxima render es `<PersistedView>` con saga row y nodos COMPENSATED.

**`event: already_complete`** cuando cliente abre stream para applicationId ya terminado. Server emite el evento y cierra el stream. Cliente hace `router.refresh()` inmediato — flow consistente con el caso happy path.

**`router.refresh()` post-complete** en lugar de `window.location.reload()`. Idiomatic Next.js, preserva scroll del usuario, ~200-400ms flash invisible (RSC re-fetch). Diferencia perceptible en pitch — el demo no "blanquea" entre fases.

**Concurrent clients: deuda slice 9+.** Hoy si dos tabs abren la misma applicationId, ambos disparan el orchestrator (V1: GET corre orchestrator). Race condition posible. Solucion futura: tabla `orchestrator_runs(application_id PK, started_at, completed_at NULL)` con UNIQUE partial index donde `completed_at IS NULL` — el segundo cliente recibe `event: already_running` y se queda solo escuchando.

---

## Coordinacion cross-cutting con orchestrator (slice 5)

Slice 8 requiere tres cambios del orchestrator que viven en `src/orchestrator/index.ts`:

1. **Emitir `span.compensated` durante saga walk-back con shape explicito.** Hoy la saga ejecuta `compensate()` de cada agente exitoso pero no emite span dedicado. Slice 8 necesita el evento para mover nodos a `COMPENSATED`. **Shape obligatorio del frame SSE:**

   ```ts
   {
     kind: 'span.compensated',
     version: 1,
     spanId: string,           // mismo spanId del span original que se compensa
     agent: AgentName,         // ej. 'bureau' — clave del reducer para mover a COMPENSATED
     compensatedAt: number,    // server-side timestamp
     reason: string,           // razon de la compensacion (ej. "policy.failed downstream")
   }
   ```

   El reducer mapea `event.agent → nodes[event.agent].state = 'COMPENSATED'`. Sin `agent` en el payload el reducer no sabe que nodo mover y la UI queda inconsistente con la verdad de la DB.

2. **Saga row debe persistir payload completo en `application_states.payload`:**

   ```ts
   {
     type: 'saga',                   // discriminator usado por deriveMode
     failedAgent: AgentName,         // que agente fallo (ej. 'policy')
     compensatedAgents: AgentName[], // orden inverso de ejecucion (ej. ['bureau', 'income', 'identity'])
     reason: string,                 // mensaje del error que disparo la saga
     failedAt: number,               // timestamp del fallo original
   }
   ```

   Hoy la saga row solo dice "saga executed" — insuficiente para que `deriveInitialGraphState(dbStates)` reconstruya nodos COMPENSATED al refresh.

3. **`deriveInitialGraphState(dbStates)` consume `compensatedAgents[]`** para marcar nodos COMPENSATED en `<PersistedView>` post-saga. La funcion vive en `src/lib/streaming/graph-reducer.ts` (mismo modulo del reducer puro) y se importa desde el server component.

Estos tres cambios entran como parte del trabajo de slice 8 (no como slice independiente) — son requisitos directos para que el grafo sea consistente entre live y persisted mode. **Tests de slice 5 deben actualizarse** para verificar el nuevo shape del payload de saga row antes de mergear slice 8.

---

## Coherencia eventos → reducer → render

Tres mapeos explicitos para garantizar que las tres capas hablen el mismo idioma:

### Eventos → NodeState (reducer)

| `event.kind` | Transicion en `nodes[event.agent].state` |
|---|---|
| `span.start` | `PENDING → RUNNING` |
| `span.complete` | `RUNNING → COMPLETE` |
| `span.failed` | `RUNNING → FAILED` |
| `span.compensated` | `COMPLETE → COMPENSATED` (solo desde COMPLETE; ignorar si state es FAILED o PENDING) |
| `span.event` (`addEvent`) | sin cambio de state, append a `nodes[agent].events[]` |
| `span.attribute` (`setAttribute`) | sin cambio de state, merge a `nodes[agent].attributes` |
| `orchestrator.complete` | `status: 'streaming' → 'complete'` (estado top-level del grafo) |
| `orchestrator.failed` | `status: 'streaming' → 'failed'` |

### NodeState → estilo SVG (render)

| State | `fill` | `stroke` | Animacion |
|---|---|---|---|
| `PENDING` | `var(--bg-elevated)` | `var(--rule)` | ninguna |
| `RUNNING` | `var(--accent-wash)` | `var(--accent)` 2px | pulse 1.6s |
| `COMPLETE` | `var(--bg-elevated)` | `var(--accent)` 1.5px | check-in 320ms |
| `FAILED` | `#F2E0DC` (decision.rejected.bg) | `#B64545` 2px | shake 200ms |
| `COMPENSATED` | `#F5EFE0` (decision.review.bg) | `#C67E2F` dashed 2px | undo-rotate 400ms |

Tokens vienen de `colors_and_type.css` del design system v2. Animaciones respetan `prefers-reduced-motion`.

### Live mode vs Persisted mode (render)

| Modo | Componente | Source | Animaciones | EventSource |
|---|---|---|---|---|
| `live` | `<LiveView>` (client) | `useGraphStream` | si | si |
| `persisted` | `<PersistedView>` (server component) | `deriveInitialGraphState(dbStates)` | no — render estatico | no |

`<GraphVisualizer>` acepta prop `mode: 'live' | 'persisted'` y cuando `mode === 'persisted'` no monta CSS animations (solo el SVG en su estado final). Esto garantiza que refrescar la pagina post-decision no produce un "replay falso" sino el snapshot final.

---

## Consequences

**Positivas:**

- Demo visualmente potente. "Watch the agent think" es la narrativa central del webinar/pitch.
- Cero cambio en agentes existentes — `BroadcastTracer` aprovecha el `Tracer` interface ya consolidado.
- A11y desde dia 1 (`prefers-reduced-motion`, keyboard nav, focus-visible).
- Reducer puro testeable sin DOM — TDD se mantiene riguroso.
- Live + persisted compartiendo `PIPELINE_NODES` y schema de eventos — consistencia visual entre modos.
- Deuda slice 9+ documentada explicitamente, no oculta.

**Negativas:**

- Vercel Hobby tier (10s timeout) es riesgo — el demo en deploy publico requiere Pro o el pipeline corto.
- AbortSignal NO propagado hoy — cliente cierra tab, orchestrator sigue corriendo y consumiendo tokens LLM. Aceptable para demo (mocks son rapidos), no para produccion.
- Sin Last-Event-ID — refresh durante stream activo pierde eventos. Aceptable para demo (refresh dispara `router.refresh()` que va a persisted mode si ya termino).
- Concurrent clients pueden disparar dos ejecuciones del mismo applicationId. Aceptable para demo (no esperamos dos oficiales mirando la misma solicitud al mismo tiempo).

---

## Alternatives considered

**Transporte:**
- WebSockets — rechazado, bidireccional no aporta para server→client unidireccional.
- Polling cada 500ms — rechazado, choppy visualmente y peor en costos.

**Flow:**
- V2 dual run — rechazado, single source of truth violado.
- V3 replay — rechazado, requiere `application_events` que no existe en slice 8.

**Eventos:**
- Nivel A (solo lifecycle) — rechazado, no muestra pensamiento.
- Nivel C (LLM tokens) — postpuesto a slice 11+, over-scope para slice 8.
- Allowlist server-side — rechazado, fragmenta single source of truth.

**Reducer:**
- setState ad-hoc en componentes — rechazado, no testeable sin DOM.
- Indexacion por `spanId` — rechazado prematuro, complica modelo cuando hoy no hay retry intra-flow. Caveat documentado para refactor futuro.

**Render:**
- React Flow — rechazado, ~200KB para grafo estatico es overkill.
- Cards lineales — rechazado, lineas paralelas se ven frágiles en el fan-out bureau/alt_score.

**Refresh:**
- `window.location.reload()` — rechazado, peor UX (blanquea, pierde scroll).
- Replay completo del stream sin refresh — rechazado, requiere `application_events` (deuda slice 9+).

---

## Deudas slice 9+ documentadas

Cada deuda con tres campos para que slice 9+ pueda accionar sin redescubrir contexto: **estado actual** (que existe hoy), **disparador** (cuando dejar de aceptarlo), **upgrade** (forma de la solucion).

### 1. Replay completo via `application_events`

- **Estado actual:** Last-Event-ID NO soportado. Cliente que pierde conexion durante stream activo pierde el gap de eventos definitivamente.
- **Disparador:** primer reporte de oficial en demo en vivo que dice "se me corto y perdi un pedazo del razonamiento". O cuando agreguemos Nivel C (LLM tokens) y la densidad de eventos haga que la perdida sea visible.
- **Upgrade:** tabla `application_events (id BIGSERIAL PK, application_id uuid FK, event_type text, payload jsonb, emitted_at timestamptz)`. Server escribe append-only en cada `controller.enqueue`. Cliente envia header `Last-Event-ID: <id>` en reconexion. Route handler hace `SELECT WHERE application_id = ? AND id > last_event_id ORDER BY id`.

### 2. Concurrent clients sin race condition

- **Estado actual:** dos tabs abriendo la misma applicationId disparan dos ejecuciones del orchestrator (V1: GET corre orchestrator). Ambos persisten estados en paralelo — race condition real, doble cobro de tokens LLM.
- **Disparador:** primera demo a 2+ personas simultaneas falla (ej. webinar donde dos asistentes abren la misma URL del demo publico). O bug report de tokens duplicados en Langfuse.
- **Upgrade:** tabla `orchestrator_runs (application_id uuid PK, started_at timestamptz NOT NULL, completed_at timestamptz NULL)`. UNIQUE partial index `WHERE completed_at IS NULL`. Segundo cliente recibe `event: already_running` con `runId` y se pone solo en modo escucha (lee eventos del run en curso, no dispara nuevo).

### 3. Heartbeats SSE para proxies con idle timeout

- **Estado actual:** sin heartbeats. Si el agente policy demora 8s en LLM, no hay trafico en el stream y proxies (Cloudflare, Vercel edge) pueden cortar la conexion por idle.
- **Disparador:** primer reporte en deploy publico de "se me corto el stream sin razon" coincidiendo con steps largos del pipeline. O al agregar Nivel C (LLM tokens) si el primer token tarda en llegar.
- **Upgrade:** intervalo cada 15s en route handler que hace `controller.enqueue(': heartbeat\n\n')` (comentario SSE, no genera evento en cliente). Cancelar el intervalo en `req.signal.addEventListener('abort', ...)`.

### 4. Backpressure en cliente con coalescing

- **Estado actual:** cada evento dispara `dispatch()` del reducer inmediatamente. Acceptable para ~5-10 eventos/seg que produce el pipeline actual.
- **Disparador:** cuando agreguemos Nivel C (token streaming) y el flujo supere ~100 eventos/seg, render thrashing visible (frames perdidos en mobile).
- **Upgrade:** buffer de eventos en `useGraphStream` con flush via `requestAnimationFrame`. Reducer recibe array de eventos por dispatch en lugar de uno a uno. Mantiene el reducer puro — solo cambia el cadence.

### 5. Persistencia localStorage para refresh durante stream activo

- **Estado actual:** refresh durante stream pierde estado en memoria. Si el flow no termino, el cliente queda en `<LiveView>` reconectando desde cero (perdiendo eventos pre-refresh).
- **Disparador:** primer reporte de oficial en produccion que dice "refresque para ver mejor un panel y se reseteo todo".
- **Upgrade:** snapshot de `GraphState` en `localStorage[applicationId]` despues de cada dispatch. Hidratacion al montar `<LiveView>`. Limpieza al transicionar a persisted mode. Stale-while-revalidate: hidrata desde localStorage instantaneo, despues sincroniza con eventos del server.

### 6. Reconnection logic con backoff exponencial

- **Estado actual:** reconexion via `EventSource` nativo (browser auto-reintenta cada ~3s indefinidamente). Sin backoff, sin maximo, sin feedback visible al usuario.
- **Disparador:** primer reporte en produccion de oficial que pierde eventos por inestabilidad de red, o de demo publico tirando trafico inutil al server post-deploy con backend caido.
- **Upgrade:** wrapper sobre `EventSource` en `useGraphStream` con backoff `1s, 2s, 4s, 8s, 16s, max 30s`. Tras 5 fallos consecutivos, mostrar banner sticky "Conexion perdida — reintentar" con boton manual. Cap en 10 intentos antes de dejar de auto-reintentar.

### 7. Naming convention `result.*` / `meta.*` / `phase.*`

- **Estado actual:** `addEvent` names son ad-hoc en cada agente: `rules.retrieved`, `llm.start`, `dti.calculated`. Sin convencion el cliente no puede filtrar por categoria visualmente.
- **Disparador:** cuando UI necesite filtros del tipo "mostrar solo resultados, ocultar meta-eventos del LLM". O cuando un nuevo agente meta `addEvent('result', ...)` y otro use `addEvent('output', ...)` y haya que reconciliar.
- **Upgrade:** convencion `result.<x>` (output del agente), `meta.<x>` (info de proceso), `phase.<x>` (transicion interna). Refactor cross-cutting de los addEvent existentes en slice 6/7. Cliente filtra por prefix.

### 8. UX polish — dwell time pre-refresh

- **Estado actual:** al recibir `orchestrator.complete`, el cliente dispara `router.refresh()` inmediato. El nodo `decision` apenas alcanza a iluminarse antes de que `<PersistedView>` lo reemplaze.
- **Disparador:** feedback en pitch que diga "no me dio chance de ver la decision aparecer en vivo". O grabacion del demo donde se ve el flash sin reposo.
- **Upgrade:** delay 500-1000ms entre `orchestrator.complete` y `router.refresh()`. Durante el delay, animacion de "pulso de victoria" en el nodo decision. Tunable via constante.

### 9. AbortSignal propagado al orchestrator

- **Estado actual:** cliente cierra tab → `req.signal.aborted` se dispara en route handler → stream se cierra. **Pero el orchestrator sigue corriendo** y consumiendo tokens LLM hasta que termine (zombie run).
- **Disparador:** primera factura de Anthropic con tokens consumidos en runs zombie (visible en Langfuse: trace sin frontend que lo viera). O cuando demo publico reciba bots que disparen runs y se vayan.
- **Upgrade:** route handler crea `AbortController` propagado a `runOrchestrator(intake, { signal })`. Cada agente verifica `signal.aborted` antes de cada step costoso (LLM call, DB write). Si abort: mark run como `cancelled` en `orchestrator_runs`, no persiste estados parciales.

### 10. Tool use de Anthropic en lugar de JSON parsing

- **Estado actual:** policy y decision agents parsean JSON del LLM con Zod. Funciona pero requiere prompt engineering pesado y manejo de errores de parseo.
- **Disparador:** segundo agente que necesite output structured (probablemente un `risk_classifier` o `fraud_detector` en slices 11+). O bug repetido de "el LLM puso un comentario en el JSON y se rompio el parse".
- **Upgrade:** migrar a Anthropic tool use (function calling). Zod schemas se vuelven tool definitions. Requiere `spanId`-indexed reducer (ver caveat en seccion 3) porque tool use puede generar retries intra-flow.

---

## Implementation gates (TDD)

Tres gates obligatorios antes de mergear:

1. **BroadcastTracer denylist test.** `span.setAttribute('cedula', '0915123456')` produce frame SSE con `cedula: '[REDACTED]'`. Sin este test, el slice no merguea.
2. **Reducer compensation test.** Secuencia de eventos `[span.start(bureau), span.complete(bureau), span.compensated(bureau)]` produce `nodes.bureau.state === 'COMPENSATED'`. Cubre el hueco critico del grilling.
3. **GraphVisualizer visual check.** Render con 6 nodos PENDING en viewport 375px y 1280px — contraste de edges legible, fan-out bureau/alt_score visible, labels español. No automatizable hoy (Playwright screenshot diff es deuda futura), validacion manual en MR.

---

## References

- Memoria #316 — `coop-credit/slice-8/grilling-completo` — registro completo del grilling con las 5 decisiones cerradas.
- ADR-0001 — TypeScript + LangGraph stack (Tracer interface).
- ADR-0006 — Parallel pipeline step (fan-out bureau/alt_score que el grafo refleja).
- ADR-0008 — decisionAgent (nodo final del grafo, output canonico).
- `src/lib/tracer/index.ts` — Tracer + Span interfaces existentes que `BroadcastTracer` adapta.
- `src/orchestrator/index.ts` — `defaultPipeline` y donde `PIPELINE_NODES` se exporta.
