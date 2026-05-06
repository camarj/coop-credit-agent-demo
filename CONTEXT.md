# CONTEXT.md — Lenguaje compartido del proyecto

> Este archivo define la jerga del dominio. Se actualiza durante sesiones de `/grill-with-docs` cuando aparece un termino nuevo o ambiguo. Evita que el agente y los humanos hablen idiomas distintos.

---

## Dominio: Microcredito en cooperativa de ahorro y credito EC

### Terminos del negocio

**Solicitante:**
La persona natural que pide un microcredito a la cooperativa.
_Avoid:_ usuario, cliente, applicant (en codigo si)

**Solicitud:**
La unidad de trabajo que entra al sistema. Contiene los datos del solicitante + monto + plazo deseados.
_Avoid:_ ticket, request, application (en codigo si)

**Decision:**
El output del sistema. Tres valores posibles: `APPROVED`, `REJECTED`, `REVIEW`. NUNCA es decision final — siempre es "decision sugerida" para que un oficial humano apruebe.
_Avoid:_ resolucion, veredicto

**Oficial de credito:**
El humano de la cooperativa que toma la decision final basandose en la decision sugerida del sistema. NO esta dentro del sistema, es el destinatario.
_Avoid:_ analista, ejecutivo

**Politica de credito:**
El conjunto de reglas internas de la cooperativa que determinan si una solicitud califica. Vive como un solo markdown sintetico en `docs/policy/cooperativa-policy.md` — escrito como una cooperativa real escribiria su manual. Cada regla es un bloque autocontenido con frontmatter (ID estable, condicion en lenguaje natural, accion sugerida, tags). Es el corpus del RAG.
_Avoid:_ reglamento, normativa

**Regla de politica:**
La unidad atomica del corpus de politica. Tiene `id` estable (`MIC-001`, `GAR-003`, etc.), `condicion` en lenguaje natural (ej. "solicitante sin afiliacion IESS, sin RUC activo"), `accion` sugerida (ej. "monto maximo USD 2,500, plazo maximo 36 meses") y `justificacion` corta. Cada regla es **un chunk natural del RAG** — no se chunkea con sliding window porque la regla ya es la unidad semantica. La UI cita las reglas que aplicaron usando su ID (`MIC-001`, `MIC-007`) como chips clicables, no snippets de prosa.
_Avoid:_ politica (es ambiguo entre "el corpus" y "una regla individual")

**Monto:**
La cantidad solicitada en USD (Ecuador usa dolar americano).

**Plazo:**
Numero de meses para pagar el credito.

### Terminos del sistema

**Agente:**
Un componente con responsabilidad unica que recibe estado, hace su trabajo y produce nuevo estado. Inputs y outputs validados con Zod schema. Tiene `execute()` y `compensate()`.
_Avoid:_ servicio, modulo, worker

**Orchestrator:**
El componente central que coordina la secuencia de agentes. Mantiene el grafo de ejecucion. Es la unica entidad con vision completa del flujo. Implementado con LangGraph.js. **Arranca con state v0 ya creado por `IntakeService`** y ejecuta el grafo desde v1 en adelante. Cuando dos agentes corren en branches paralelas (fan-out), LangGraph maneja el join — sus contribuciones viven en namespaces distintos y no colisionan.
_Avoid:_ coordinator, manager, controller

**Estado (state):**
Un snapshot inmutable de la solicitud en un punto del flujo. Cada agente produce un nuevo estado, nunca modifica uno existente. Tiene `version`, `created_by_agent`, `created_at`, `contribution`.

**Cada row guarda SOLO la `contribution` del agente que la produjo — nunca el FullState reconstruido.** El `FullState` (estado completo merged) se reconstruye via `getLatestFullState()` haciendo `reduce` sobre todas las versions con spread. Cada agente que no es `intake` namespacea su contribution bajo su nombre — ej. `identity` escribe `{ identity: { name, birthDate, valid } }`. Esto previene colisiones entre agentes que tienen campos con el mismo nombre (ej. `bureau.score` vs `altScore.score`).

`intake` es excepcion documentada: escribe sus 4 campos flat (`{ cedula, ingresos, monto, plazo }`) porque son los datos primarios crudos de la solicitud, no la contribucion de un agente.
_Avoid:_ contexto (es ambiguo), payload

**Trace:**
El registro completo de que paso durante el procesamiento de una solicitud: que agentes corrieron, en que orden, con que inputs, que devolvieron, cuanto tomaron, que costaron en tokens.
_Avoid:_ log, history

**Snapshot:**
Sinonimo de estado en un momento especifico. Usar "estado" preferentemente; "snapshot" solo cuando se quiera enfatizar la inmutabilidad.

**Saga:**
La secuencia ordenada de `compensate()` calls que el orchestrator ejecuta cuando una etapa falla y hay que revertir efectos colaterales (ej. liberar lock del bureau).

**Circuit breaker:**
El componente que envuelve llamadas a servicios externos (mocks). Tiene 3 estados: `CLOSED` (normal), `OPEN` (falla, no llama, falla rapido), `HALF_OPEN` (despues de cooldown, prueba con 1 request).
_Avoid:_ disyuntor (en codigo en ingles)

**IntakeService:**
Factory que recibe el body del `POST /api/applications`, valida con Zod, persiste `applications` + state v0 en una sola transaccion Postgres, y devuelve `applicationId`. **NO es un agente** y NO es un nodo del grafo — el orchestrator se invoca despues de que intake completa, partiendo de v0 ya persistido. Si intake falla, el rollback es transaccional (Postgres), no saga compensation. Vive en `src/services/intake/`.
_Avoid:_ intakeAgent (deprecated), intake node

**OperationalError:**
Error que indica falla operacional del servicio externo: timeout, error 5xx, conexion de red caida. **Cuenta para el contador del circuit breaker.** El wrapper `withCircuitBreaker` lo lanza cuando el breaker esta `OPEN` (fail-fast sin intentar) o cuando un timeout dispara — siempre via clase explicita, no propaga el error original del mock al expirar.

**DomainError:**
Error semantico del dominio: cedula no existe, score insuficiente, recurso no encontrado. **NO cuenta para el breaker** — el servicio respondio correctamente, solo que la respuesta es un "no". Pasa transparente al caller via `withCircuitBreaker`.

**Tool:**
Una funcion que un agente LLM puede invocar. Tiene schema Zod estricto para input y output. NO confundir con "agente" — un agente puede usar varios tools.

**allowedTools:**
Lista explicita de tool names que cada agente puede invocar. Declarada en `agents/{name}/config.ts`. Guard en runtime emite `UnauthorizedToolError` si un agente intenta usar un tool fuera de su lista. Ej: `policy.allowedTools = ['rag.retrieve', 'rag.rerank']`.

**Confidence:**
Numero en `[0, 1]` adjunto a cada `Decision`. **Es funcion deterministica de las senales upstream** (resultados de los agentes anteriores) — NO es autoasignada por el LLM. El LLM solo redacta la justificacion en lenguaje natural. La semantica del campo depende del `decisionType`: para `hard_reject` siempre es `1.0` (certeza regulatoria); para `llm_decision` es estimacion estadistica calibrable.

**Confidence threshold:**
Umbral configurable (default `0.75`, env var `CONFIDENCE_THRESHOLD`). Solo aplica cuando `decisionType === 'llm_decision'`. Si `confidence < threshold`, la `Decision` se marca para escalar a oficial humano explicitamente — la decision sigue siendo "sugerida" pero la UI la presenta distinta. Los hard rejects NUNCA pasan por este umbral; siempre se escalan a un oficial con etiqueta diferente.

**Decision type:**
Discriminador del origen de la `Decision`. Dos valores:
- `hard_reject` — produced por `preDecide()`, una funcion pura sobre senales autoritativas (Registro Civil, IESS, bureau). Bypassea el LLM. **Reservado para casos constitucionales** — situaciones donde NO existe ningun caso de negocio razonable bajo el cual aprobar (menor de edad, persona fallecida, sobreendeudamiento computable con datos verificables). NO se usa para reglas de negocio variables (ej. tope etario, productos especiales) que podrian tener overrides.
- `llm_decision` — producido por `computeConfidence()` deterministico + LLM call que redacta `reason`. Cubre todo lo demas (la mayoria de los casos).

El campo es un discriminador explicito en el output del agente; downstream (UI, analytics, eval) filtra por el primero antes de leer `confidence` para evitar mezclar "certeza regulatoria" con "estimacion estadistica del modelo".

**Hard reject (rechazo automatico):**
Una `Decision = REJECTED` producida por `preDecide()` sin invocar el LLM. Tres categorias hoy:
1. **Suplantacion de identidad** — Registro Civil reporta cedula como fallecida (espejo de `EXC-001`)
2. **Capacidad legal** — solicitante menor de 18 anios (espejo de la mitad "menor" de `EXC-002`; el techo etario `>75` NO es hard reject porque algunas cooperativas ofrecen producto senior con codeudor — esa parte queda como soft signal en confidence)
3. **Sobreendeudamiento computable** — `(deudas_bureau + cuota_proyectada) / income.salary > 0.5`. Solo aplica cuando `income.salary` viene del IESS (autoritativo); para autonomos sin IESS no hay sueldo verificado, asi que no se evalua hard — pasa al confidence con peso menor (espejo de `EXC-003`).

**Reglas constitucionales:**
Las que entran a `preDecide()`. Criterio de inclusion: **"NO existe ningun caso de negocio razonable donde aprobar este perfil sea aceptable"**. Si la respuesta es "depende, hay overrides posibles", la regla NO es constitucional — va a la formula soft de confidence. Esto evita que `preDecide()` se vuelva el contenedor de toda la logica de negocio.

**Audit trail (auditabilidad):**
Cada `Decision` (hard o soft) persiste suficiente metadata para que un regulador o auditor reconstruya la decision sin correr el sistema. Para hard rejects: `triggeredBy: { field, value, computed }` capturando el campo del state que disparo la regla, su valor crudo, y cualquier valor derivado (ej. edad calculada de birthDate). Para llm_decision: `confidence` numerico, breakdown de senales con peso, `reason` del LLM, `citedRules` que aparecen en el manual.

**Fuente autoritativa:**
Un dato es "autoritativo" cuando proviene de un cruce con sistema externo verificable (Registro Civil, IESS, bureau Equifax, SRI). Datos auto-declarados en el formulario (`state.ingresos`, `state.monto`, `state.plazo`) NO son autoritativos. La red de seguridad de `preDecide()` solo es valida sobre inputs autoritativos: si el dato es LLM-extracted, OCR sin verificar o auto-declarado, no se puede considerar safety net regulatoria.

**Token budget:**
Limite hard de tokens (input + output) consumibles por una `Solicitud` completa. Default `50_000`, env var `TOKEN_BUDGET_PER_APPLICATION`. Si la suma excede, el orchestrator detiene la pipeline, marca la solicitud como `REVIEW` con razon `token_budget_exceeded`, y dispara la saga. **Estado actual (post-slice 7):** _counting only_ — los tokens consumidos por agente se persisten en `application_token_usage` (tabla nueva) pero el enforcement contra el threshold no esta implementado. Slice 9 cierra enforcement con threshold operativo recalibrado desde la data persistida. Ver ADR-0008 seccion 9.

**Idempotency key:**
UUID generado client-side incluido en cada submit de solicitud. Constraint `UNIQUE` en DB previene duplicados ante doble-click o retries de red. Si llega un submit con un key ya procesado, el API devuelve la decision existente sin re-procesar.

**Hard inquiry:**
Efecto colateral simulado de `EquifaxMock.requestHardPull()`. Cada pull registra un hard inquiry en el estado interno in-memory del mock (Map<cedula, HardInquiry[]>). Persiste **entre solicitudes de la misma cedula durante el lifetime del proceso** — si la misma persona pide 3 creditos, su score acumula 3 penalties. Formula: `score = max(SCORE_FLOOR, baseScore − HARD_INQUIRY_PENALTY × count)`. Defaults: penalty 30, floor 300 (penalty mas alta que la realidad para que el efecto sea visible en demo en vivo — flippeable en `services/mocks/equifax/config.ts`). Reversible via `bureauAgent.compensate()` que llama `removeLastHardInquiry(cedula)` — esto es lo que hace que la saga sea **real, no teatral**. Ver ADR-0005.

**Saga state row:**
Cuando la saga walk-back ejecuta al menos un `compensate()`, el orchestrator escribe **una sola row adicional** en `application_states` con `created_by_agent='orchestrator'` y `contribution={ __saga: { compensated, reason, completedAt } }`. El doble-underscore `__saga` marca metadata del orchestrator (no contribucion de agente). `getLatestFullState` merge sin tratamiento especial — `state.__saga` queda como key top-level. Ver ADR-0005.

**EquifaxMock:**
Simula buro de credito. Modos: `happy`, `slow` (5s), `error_429`, `score_bajo`, `score_alto`. Devuelve `{ score, history, hardInquiriesCount }`. UNICO mock con side effect reversible — los demas (RegistroCivil, IESS, ScoreAlternativo) son read-only y sus `compensate()` son no-op. Vive en `src/services/mocks/equifax/`.

**Razonamiento (streaming):**
Eventos estructurados que un agente emite durante su ejecucion (NO son tokens del LLM streamed, son discretos): `{ agent, step, message }`. Llegan a la UI via SSE y se muestran en un panel lateral por nodo activo. Hace visible el "pensar en voz alta" del sistema.

### Mocks de servicios externos

**RegistroCivilMock:**
Simula la API del Registro Civil de Ecuador para validar cedula. Devuelve nombres, fecha de nacimiento, lugar de nacimiento.

**IessMock:**
Simula la API del IESS (seguridad social EC) para verificar afiliacion laboral, sueldo declarado, antiguedad. Modos: `happy`, `slow` (8s), `error_503`, `sin_afiliacion`. Devuelve `{ employer, salary, monthsActive }` o lanza `DomainError('sin_afiliacion')` cuando la persona es autónoma o fallecida. Breaker config tolerante (failureThreshold 7, timeoutMs 15s) — IESS es notoriamente lento. Vive en `src/services/mocks/iess/`.

**EquifaxMock:** ver entrada detallada arriba en "Hard inquiry" — UNICO mock con side effect reversible.

**ScoreAlternativoMock:**
Simula un servicio de scoring alternativo (sin reportar, basado en patrones de gasto sintetizados). Devuelve `{ score: number /* 0-100 */, signals: string[] }`. Modos: `happy`, `slow` (2s, bajo el timeout de 5s del breaker), `error_500` (cuenta para breaker, abre tras 5 fallos), `sin_data` (DomainError, NO cuenta para breaker — el servicio respondio bien, solo que no tiene cobertura). Read-only — no expone `compensate()`. Vive en `src/services/mocks/score-alternativo/`.

**Score alternativo:**
Score sintetico `[0, 100]` derivado de patrones de gasto y huella digital del solicitante. Es **complementario** al score crediticio del bureau: cubre solicitantes thin-file (sin historial Equifax) y agrega senales cualitativas (`stable_spending`, `no_chargebacks`, `high_digital_footprint`, `young_account`, etc.). 30 de 45 personas del dataset tienen `altScore`; los autonomos sin huella y los fallecidos no. Producido por `altScoreAgent` corriendo **en paralelo** con `bureauAgent` (ver "Pipeline paralelo" abajo).
_Avoid:_ score sintetico (en codigo si: `alt_score`)

**Pipeline paralelo:**
La pipeline default del orchestrator es `[identity, income, [bureau, alt_score]]` — el ultimo step es un array de agentes que corren con `Promise.allSettled`. La regla dura es **versiones pre-asignadas por orden de array**, no por wall-clock. Si `[bureau, alt_score]` arranca con version actual = 2, bureau persiste en v3 y alt_score en v4 sin importar quien resuelva primero. Si una rama paralela falla, la saga compensa **solo las exitosas del mismo step** y aborta el resto de la pipeline. Ver ADR-0006.

---

## Relaciones

- Una **Solicitud** produce muchos **Estados** (uno por cada **Agente** que corre)
- El **Orchestrator** ejecuta **Agentes** en secuencia segun el grafo
- Cada **Agente** envuelve sus llamadas a mocks con un **Circuit breaker**
- Un **Trace** observa todo el procesamiento de una **Solicitud**
- Si un **Agente** falla, el **Orchestrator** dispara una **Saga** con los `compensate()` de los agentes anteriores
- La **Decision** final se persiste como el ultimo **Estado** de la **Solicitud**

---

## Ambiguedades resueltas

- "request" vs "solicitud" — en codigo TypeScript usar `Application` o `application`. En documentacion y UI usar "solicitud".
- "estado" vs "state" — siempre "estado" en docs/UI; en codigo `State`.
- "decision" vs "decision sugerida" — siempre aclarar "sugerida" en UI orientada a oficial. En codigo `SuggestedDecision`.

---

*Mantener este archivo actualizado durante sesiones de `/grill-with-docs`.*
