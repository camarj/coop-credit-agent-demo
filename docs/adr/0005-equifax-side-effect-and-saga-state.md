# ADR-0005 — EquifaxMock side effect + saga state row

**Status:** Accepted
**Date:** 2026-05-04
**Deciders:** Raul Camacho

---

## Context

Slice 4 introduce el primer mock con **side effect reversible**: `EquifaxMock.requestHardPull(cedula)` no es read-only — registra un hard inquiry en el estado interno del mock, y el score reportado baja con cada inquiry acumulado. Esto es lo que distingue una **saga real** de una saga teatral: sin side effect que reverter, no hay nada que demostrar.

Slice 4 tambien introduce la **saga walk-back** en el orchestrator: cuando una etapa posterior a un agente con side effect falla, el orchestrator camina hacia atras llamando `compensate()` en orden inverso. Y aterriza el **registro persistente** del hecho de que la saga ejecuto.

Esto fuerza tres decisiones que aplican al resto del proyecto.

## Decision

### 1. EquifaxMock guarda hard inquiries en module-state

`Map<cedula, HardInquiry[]>` vive a nivel de modulo en `services/mocks/equifax/index.ts`. Cada `requestHardPull` push un inquiry. Los inquiries persisten **entre solicitudes de la misma cedula durante el lifetime del proceso del mock** — es lo que da realismo: si Maria pide 3 creditos seguidos y los 3 pulls van a Equifax, su score baja por los 3 acumulados.

`__resetForTesting()` exportado limpia el Map. No hay persistencia entre restarts del proceso (el demo es proceso unico, esto alcanza).

### 2. Score formula: `baseScore − HARD_INQUIRY_PENALTY × count`, piso `SCORE_FLOOR`

Constantes en `services/mocks/equifax/config.ts`:

```ts
export const HARD_INQUIRY_PENALTY = 30;
export const SCORE_FLOOR = 300;
```

La penalty es **intencionalmente mas alta que la realidad** (~5-10 puntos en Equifax real). 30 puntos hace que el efecto sea **visible en pantalla** durante una demo en vivo: pull → 720 a 690, saga compensa → 690 a 720. Si una persona pide aprobacion para 5 creditos seguidos, su score se va de 720 a 570 — drama suficiente para que el oficial entienda el problema en 5 segundos.

Si en algun pitch un prospect cuestiona el realismo, flippeas la constante a 10 sin tocar otro codigo. La penalty no esta acoplada a logica de policy.

### 3. `compensate()` revierte el side effect via `removeLastHardInquiry`

`bureauAgent.compensate({ cedula })` llama `equifaxClient.removeLastHardInquiry(cedula)` que pop-ea el ultimo inquiry del array para esa cedula. **Es idempotente sobre array vacio** (no underflow). **NO va a traves del breaker** — la compensacion debe ser confiable incluso cuando el breaker esta `OPEN`, sino la saga no puede limpiar.

Otros mocks (RegistroCivil, IESS) son read-only — sus `compensate()` son no-op. El AC de slice 4 lo enfatiza: "EquifaxMock simula side-effect reversible; otros 3 mocks read-only".

### 4. Saga state persistido como una sola row con namespace `__saga`

Cuando la saga walk-back ejecuta al menos un compensate, el orchestrator escribe **una sola row adicional** en `application_states`:

```
created_by_agent: 'orchestrator'
contribution: {
  __saga: {
    compensated: ['bureau'],          // chronological order of agents whose compensate() ran
    reason: 'OperationalError: failing_test_agent_threw',
    completedAt: '2026-05-04T19:42:34.395Z'
  }
}
```

El doble-underscore `__saga` marca **metadata del orchestrator**, no contribucion de agente. La regla de namespacing por agente (ADR-0004) se mantiene: agentes escriben bajo su nombre, orchestrator escribe bajo `__saga`. `getLatestFullState` merge sin tratamiento especial — `state.__saga` queda como key top-level.

### 5. Orchestrator acepta `agents: Agent[]` como parametro

`runOrchestrator(applicationId, ctx, agents)`. Production passes `defaultPipeline = [identityAgent, incomeAgent, bureauAgent]`. Tests pueden pasar `[...defaultPipeline, failingTestAgent]` para forzar un fallo despues de bureau y exercitar el walk-back sin esperar a slice 7.

Tambien deja preparado al orchestrator para slice 5+ — cuando se introduzca un parallel branch (`alt_score | bureau`), el orchestrator solo compone lo que recibe.

## Rationale

### Por que side effect en module-state vs DB

Persistir inquiries en Postgres seria mas realista, pero:

1. **YAGNI.** El demo corre como proceso unico. No hay multi-instancia que requiera estado compartido.
2. **Tests ruidosos.** Cada test tendria que limpiar la tabla de inquiries. `__resetForTesting()` en memoria es 1 linea.
3. **El registro real del hard inquiry vive en el state v3 de la solicitud.** Eso si esta en DB. El Map del mock es solo el "estado de Equifax desde fuera" — el bureau real tampoco te deja ver su tabla interna.

### Por que penalty 30 (no realista)

Anthropic + Bhaumik los dos coincidieron: en demos de sistemas multi-agent, el efecto debe ser **legible a 3 metros**. 5-10 puntos no se ven en una demo en vivo. 30 puntos si se ven, y el oficial entiende.

La realidad cuenta cuando el demo se vende como producto (slice 13 + post). Hasta entonces, lo que importa es que el patron sea **demostrable** y **medible** durante la presentacion.

### Por que NO ir a traves del breaker en `removeLastHardInquiry`

Compensate **debe ser confiable**. Si el breaker esta abierto (porque Equifax cayo 5 veces en error_429), pero ANTES de que cayera ya hicimos un pull exitoso, ese inquiry esta registrado en nuestro Map. El breaker esta abierto contra futuros pulls, no contra cleanup de side effects que ya hicimos.

`removeLastHardInquiry` toca solo memoria local del mock — no hay riesgo de timeout, error 503, ni red caida. Mandarlo por el breaker seria engadirle ceremonia sin beneficio.

### Por que el saga es UNA row, no multi-row por compensate

Multi-row tendria sentido si el demo tuviera operadores observando timeline al detalle. Para nuestro caso (oficial humano que ve el resultado final + razonamiento), una row resume "que se compenso, por que, cuando". Mas limpio y mas barato de renderizar en UI.

Si en el futuro quisieramos timestamps por compensate individual, los podemos agregar al array `compensated` como objetos `{ agent, at }`. Migracion no destructiva.

### Por que `__saga` y no una columna nueva

Una columna nueva en `application_states` (ej. `meta jsonb`) seria intrusiva — afectaria a TODAS las rows aunque la mayoria no la use. El namespace dunder vive donde ya vive todo lo demas (en `contribution`). Mantiene el schema flat y permite que `__saga` aparezca solo cuando hay saga.

## Consequences

### Positivas

- La saga es **demostrable en vivo**: se ve el score bajando y volviendo arriba.
- Tests del bureau y del orchestrator son granulares y rapidos (pure in-memory).
- El orchestrator queda preparado para parallel branches (slice 5) sin refactor — solo recibir `agents` distintos.
- `__saga` es discoverable: aparece en el FullState cuando hay una, brilla por su ausencia cuando no.

### Negativas

- **Estado del mock no persiste entre restarts.** Si el dev reinicia el server entre dos requests del mismo solicitante, los inquiries previos se pierden. Aceptable para demo; en pre-prod habria que persistir.
- **El array `compensated` no captura timestamps individuales.** Si en el futuro el demo necesita "compensate de bureau a las 14:33:01.234, compensate de income a las 14:33:01.345" eso requiere refactor (de strings a objetos en el array).
- **30 puntos de penalty es alto.** Si un prospect pregunta "¿de donde sale ese numero?" hay que explicar que es de demo, no de modelo.

### Mitigacion

- Documentar en CONTEXT.md la naturaleza del side effect y su persistencia in-memory.
- Si en algun pitch surge la pregunta del numero, flippear `HARD_INQUIRY_PENALTY` a 10 antes del demo y mencionarlo si Raul lo prefiere.
- Cuando la pipeline del demo se acerque a produccion (slice 13+), persistir el Map a Redis o DB.

## Open questions

- ¿Que pasa si compensate falla? **Decision actual:** capturamos el error y continuamos con el siguiente compensate (best-effort). El error original NO se enmascara — se re-tira despues del walk-back. Esto puede llevar a estado inconsistente si una compensacion critica falla, pero el demo no tiene compensaciones criticas en este sentido. Slice 9+ (eval suite) puede agregar metricas de compensaciones fallidas.
- ¿La UI debe mostrar el saga en tiempo real (animacion)? **Diferida a slice 8** (live graph visualizer + SSE). Por ahora la UI muestra un banner estatico cuando `state.__saga` existe.
