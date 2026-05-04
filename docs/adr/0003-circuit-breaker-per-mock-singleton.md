# ADR-0003 — Circuit breaker per-mock-singleton

**Status:** Accepted
**Date:** 2026-05-04
**Deciders:** Raul Camacho

---

## Context

Slice 2 introduce el primer mock externo (`RegistroCivilMock`) y por lo tanto el primer circuit breaker del sistema. Esto fuerza tres decisiones que aplican al resto del proyecto: **topologia** del breaker (per-mock vs per-agent), **que cuenta como falla**, y **donde vive** la instancia.

Las cuatro APIs externas del demo son mocks que el oficial puede tumbar a voluntad para mostrar circuit breakers en accion. Cada mock tiene 1:1 mapping con un agente en slices 1-3:

- `identity` → `RegistroCivilMock`
- `income` → `IessMock`
- `bureau` → `EquifaxMock`
- `alt_score` → `ScoreAlternativoMock`

A futuro pueden aparecer agentes que compartan dependency (un hipotetico `verification` que tambien valida cedula contra Registro Civil), o un breaker para llamadas al LLM (item 9 del feature set / slice 9).

## Decision

### 1. Topologia: per-mock-singleton

**Hay UN breaker por mock, compartido entre todos los agentes que lo usen.**

```ts
// services/mocks/registro-civil/index.ts
const breaker = createBreaker({ failureThreshold: 5, ... });

export function getRegistroCivilClient() {
  return {
    getPerson: (cedula: string) => breaker.call(() => internalGetPerson(cedula)),
  };
}
```

### 2. Storage: module-scoped const

El singleton vive como `const` dentro del archivo del mock — no hay registry central. Cada mock exporta `__resetForTesting()` para limpiar su breaker entre tests.

Refactor a registry centralizado se difiere a la slice donde aparezca el segundo tipo de breaker (slice 9 — LLM breaker). YAGNI hasta entonces.

### 3. Que cuenta como falla del breaker

El wrapper distingue dos tipos de error explicitos:

| Evento | ¿Cuenta como failure? |
|---|---|
| `OperationalError` (timeout, 5xx, red caida) | ✅ SI |
| `DomainError` (not_found, score insuficiente) | ❌ NO — pasa transparente |
| Input invalido (Zod rechaza antes de llamar al mock) | ❌ NO — ni siquiera se intenta |
| Breaker ya esta `OPEN` (fail-fast) | ❌ NO incrementa — solo se incrementa cuando hubo intento real |

El timeout es responsabilidad del wrapper: cuando expira, lanza `OperationalError('timeout')` explicitamente — NO propaga lo que sea que el mock devuelva al expirar.

### 4. Configuracion: per-mock

Cada mock define sus propios thresholds segun caracteristicas reales del servicio que simula. Los defaults globales del feature set (timeouts mock 10s / LLM 30s / total 120s) son referencia, no obligacion.

```ts
// services/mocks/registro-civil/index.ts
const breakerConfig = {
  failureThreshold: 5,
  cooldownMs: 60_000,
  halfOpenMaxCalls: 1,
  timeoutMs: 10_000,
};

// services/mocks/iess/index.ts (slice 3)
const breakerConfig = {
  failureThreshold: 7,    // mas tolerante: IESS es notoriamente lento
  cooldownMs: 90_000,
  halfOpenMaxCalls: 1,
  timeoutMs: 15_000,
};
```

### 5. Control para el demo

- **Default — organico:** la UI tiene `setMode('error_500')` por mock. Mando 5 solicitudes, las 5 fallan, breaker se abre solo. Es la pedagogia real del patron.
- **Forzado dev-only:** endpoint `POST /_dev/breakers/:name/force-open` se difiere a slice 4+ (cuando hay 2-3 breakers y vale la pena el dev-tooling). Solo activable con `process.env.ENABLE_DEV_CONTROLS === 'true'`.

## Rationale

### Por que per-mock-singleton (vs per-agent)

1. **El breaker representa la salud del SERVICIO EXTERNO, no del agente que llama.** Si Registro Civil esta caido, lo esta para todos. Patron clasico de Nygard / Hystrix / Resilience4j: el breaker pertenece a la dependency.
2. **En slices 1-3 el mapeo es 1:1**, asi que en runtime per-mock y per-agent son indistinguibles HOY. Ganamos cuando alguien agregue un segundo agente que comparta dependency.
3. **Pedagogia del demo.** Es mas potente mostrar "este es el breaker del Registro Civil — un nodo del sistema con su propia salud" que "este es el breaker del agente identity, este otro es del agente verification".
4. **Trade-off honesto:** un agente buggy que mande inputs basura podria abrir el breaker compartido y joder a otros agentes que comparten dependency. Mitigacion: `inputSchema.parse` antes de la llamada al mock — input invalido no llega a contar como llamada al servicio.

### Por que module-scoped (vs registry central)

1. **YAGNI.** Para 4 breakers iguales, un registry es over-engineering. La migracion mecanica (`const breaker = createBreaker(...)` → `const breaker = registry.get(...)`) es trivial cuando llegue.
2. **Tests faciles.** `__resetForTesting()` exportado por el mock es 3 lineas. Reset del registry seria lifecycle management adicional.

### Por que `OperationalError` vs `DomainError` con clases explicitas

1. **Sin la distincion, un mock que responde "cedula no existe" 5 veces seguidas abriria el breaker** — pero esa NO es una falla del servicio, es una respuesta semantica valida. Eso seria un bug pedagogico (rompe la promesa del patron) y un bug funcional (el breaker se abre cuando no debe).
2. **Clases explicitas** evitan tener que clasificar errores por inspeccion de status code o de message — es discriminacion por tipo, exacto y explicito.
3. **El wrapper SIEMPRE lanza `OperationalError` por timeout** — no propaga el error nativo del mock al expirar. Esto centraliza la logica de "que cuenta como fallo operacional".

## Consequences

### Positivas

- Comportamiento correcto cuando un dependency tiene multiples callers.
- Demo en vivo se cuenta mejor: un breaker visible por servicio externo, no N×M breakers.
- El test del breaker es localmente testable sin levantar el grafo entero.
- Errores semanticos del dominio no contaminan el contador de salud del servicio.

### Negativas

- **Acoplamiento a futuro.** Cuando llegue el primer breaker fuera de mocks (LLM, slice 9), refactor obligatorio a registry. Aceptable porque la migracion es mecanica.
- **Test parallelism** dentro de un solo mock requiere sincronizacion. Cada test suite debe llamar `__resetForTesting()` en `beforeEach`, y los tests dentro del mismo file no pueden correr en paralelo si tocan el breaker. Vitest lo permite con `test.sequential` o desactivando paralelismo por archivo.

### Mitigacion

- `__resetForTesting()` exportado por cada mock (no opcional — es invariante de testing).
- Documentar en CONTEXT.md la distincion `OperationalError` vs `DomainError` para que futuros agentes sepan cual lanzar.
- Cuando llegue slice 9, crear ADR adicional documentando la migracion a registry y el setup del LLM breaker.

## Open questions

- ¿Como expone el breaker su estado a la UI? **Diferida a slice 8** (live graph visualizer + SSE). Por ahora el wrapper agrega `breaker.state`, `breaker.failureCount`, `breaker.lastTransition` como atributos del span del tracer — visible en console output, suficiente para el AC de slice 2.
- ¿Persistencia del estado del breaker entre restarts del proceso? **No por ahora.** El demo es un proceso unico, los breakers se reinician al restart. Persistencia tendria sentido en una version multi-instancia con Redis — fuera de scope del demo.
