# ADR-0006 — Parallel pipeline step with pre-assigned versions

**Status:** Accepted
**Date:** 2026-05-04
**Deciders:** Raul Camacho

---

## Context

Slice 5 introduce el primer **fan-out** del orchestrator: `bureauAgent` y `altScoreAgent` no dependen el uno del otro — ambos solo leen `cedula` del state — y un sistema realista los corre en paralelo para reducir latencia. Esto fuerza tres preguntas que afectan a la API del orchestrator y al modelo de versionado para todo el resto del proyecto:

1. ¿Como se declara una rama paralela? ¿Otro tipo de nodo, una clase nueva, o algo mas pequeno?
2. ¿Que version recibe cada agente paralelo si pueden terminar en cualquier orden de wall-clock? ¿Asignar la version cuando el agente termina (orden real) o pre-asignarla cuando arranca (orden de declaracion)?
3. Si una rama paralela falla, ¿que tiene que compensarse? ¿La rama exitosa del mismo step, los pasos anteriores, ambos?

Las respuestas tienen que ser consistentes con ADR-0001 (orchestration sobre choreography), ADR-0004 (delta + namespacing) y ADR-0005 (saga walk-back con compensate LIFO).

## Decision

### 1. Pipeline shape: `Array<Agent | Agent[]>`

La pipeline pasa de `Agent[]` a `(Agent | Agent[])[]`. **El array anidado es un step paralelo. El item plano es un step serial.**

```ts
export type PipelineStep = AnyAgent | AnyAgent[];
export type Pipeline = PipelineStep[];

export const defaultPipeline: Pipeline = [
  identityAgent,         // serial
  incomeAgent,           // serial
  [bureauAgent, altScoreAgent], // paralelo
];
```

**Por que esto y no algo mas elaborado.**

Considere tres alternativas y rechace las tres:

- **Builder fluido (`pipeline().then(a).parallel(b, c)`)**: agrega una API que reproduce el shape literal del array sin agregar expresividad. Mas codigo para mantener, mas linea entre la declaracion y la ejecucion.
- **LangGraph nativo con nodos y edges**: Slice 5 todavia no tiene LangGraph instalado. La pipeline actual es declaracion lineal de pasos — meter un grafo formal antes de necesitar joins condicionales / cycles seria over-engineering. Cuando llegue el slice que necesite branching condicional (ej. si bureau.score < threshold entonces saltar X), ahi se justifica LangGraph; hasta entonces, el array de array dice todo lo que hay que decir.
- **Tipo distinto `ParallelStep` con discriminator**: el discriminator no agrega informacion sobre lo que ya dice `Array.isArray`. Un check de tipo en `runStep` cubre el caso sin invitar a otros lugares a hacer el mismo check.

La regla dura: **el `Array.isArray` que diferencia serial de paralelo vive en exactamente UN lugar — `runStep`**. Si aparece en otro modulo (UI, tracer, repository), es un smell.

### 2. Versions pre-asignadas por orden de declaracion en el array

Antes de disparar `Promise.allSettled` sobre los agentes de un step paralelo, el orchestrator lee la `nextVersion` actual y le asigna a cada agente `baseVersion + indexInArray`. La version queda fijada **antes de que cualquier agente arranque su trabajo**. El orden de termino en wall-clock es irrelevante.

```ts
// step = [bureau, altScore], current latest = v2
const baseVersion = await nextVersion(applicationId); // 3

await Promise.allSettled(
  agents.map((agent, i) =>
    executeAgent(agent, applicationId, baseVersion + i, ctx),
    //                                  ^^^^^^^^^^^^^^^ pre-assigned
  ),
);
// → bureau persists at v3, alt_score at v4 — siempre, sin importar quien termine primero
```

**Por que.**

Hay dos enfoques validos en sistemas reales:

- **Wall-clock order**: el primero que termina toma `nextVersion`, el segundo el siguiente. Refleja la realidad del orden de eventos.
- **Declaration order (pre-assigned)**: la version queda atada al lugar en el array.

Elegimos pre-assigned por tres razones:

1. **Tests deterministas sin sleeps ni mocks de tiempo.** Si un test asume "v3 = bureau, v4 = alt_score" y el orden depende de wall-clock, el test es flaky en CI o requiere fake timers + barriers — un costo permanente para todos los tests del orchestrator. Pre-asignar elimina la flakiness en la raiz.
2. **La UI / repository pueden filtrar por agente, no por version.** En el state page, `bureauRow = states.find(s => s.createdByAgent === 'bureau')`. La version es un detalle de auditoria, no una clave de lookup. Wall-clock order tampoco rompe esto, pero pre-asignar lo deja explicito en el contrato.
3. **La saga necesita orden estable para el walk-back.** Si la rama paralela "falla en posicion 1" (alt_score), tener `compensated: ['bureau']` con bureau en v3 es predecible; si las versions bailan, la auditoria del saga row se vuelve dependiente del clima.

El costo: el AC de issue #5 hablaba de "orchestrator agnostico al orden de persistencia". Esto se cumple — la **persistencia** ocurre en el orden que termina cada agente, pero la **version asignada** no depende de eso. La auditoria es estable.

### 3. Saga semantica para fallas en step paralelo

Cuando un step paralelo tiene un fallo, el orchestrator:

1. Recolecta los agentes del step que **si** completaron exitosamente (sus versions pre-asignadas ya quedaron persistidas).
2. Sale del loop con la primera `reason` observada (Promise.allSettled fidelity — no enmascarar el error original con un AggregateError).
3. Camina hacia atras LIFO igual que un step serial: primero compensa los exitosos del step paralelo (concurrentemente entre si — son independientes por construccion), despues los steps seriales anteriores.

```
pipeline = [identity, income, [bureau, alt_score], decision]
            v1        v2       v3,v4              v5

Si decision falla:
- compensate(alt_score) y compensate(bureau) en paralelo
- compensate(income) — no-op, read-only
- compensate(identity) — no-op, read-only
- saga row con compensated = ['bureau', 'alt_score']

Si alt_score falla y bureau completa:
- bureau queda persistido en v3
- compensate(bureau) — revierte hard inquiry
- compensate(income), compensate(identity) — no-op
- saga row con compensated = ['bureau']
- el error original es DomainError de alt_score (no se convierte a AggregateError)
```

**Compensacion intra-step concurrente, inter-step secuencial.**

Dentro de un step paralelo, los agentes no tienen dependencia causal entre si — por eso pueden compensar en paralelo. Entre steps, hay dependencia causal (income leyo lo que identity escribio), asi que la compensacion mantiene el orden inverso del flujo.

**Compensation failures se tragan.** Si `compensate()` de bureau falla durante la saga, no debe enmascarar el error original que disparo la saga. Logueamos via tracer y seguimos. Esto ya estaba en ADR-0005, lo extendemos al caso paralelo sin cambios.

## Consequences

### Positivas

- Latencia: los dos mocks (Equifax y ScoreAlternativo) corren simultaneamente. En un demo en vivo con `slow` mode (Equifax 5s + AltScore 2s), antes era 7s secuencial y ahora 5s en paralelo.
- API del orchestrator sigue siendo declarativa y leible — un humano puede ver la pipeline y saber que es lo que pasa sin ejecutar nada.
- El versionado no tiene casos especiales: el shape `(Agent | Agent[])[]` cubre serial y paralelo con un solo helper (`runStep`).
- Tests no necesitan fake timers ni barriers — el orden de versions es determinista por construccion.

### Negativas

- Si en el futuro queremos branching condicional (ej. "si score < X, saltar alt_score"), este shape no lo cubre y vamos a necesitar pasar a LangGraph formal. Aceptable: cuando llegue, sera una decision de su slice, no algo que tengamos que adelantar ahora.
- Pre-asignar versions deja huecos cuando una rama paralela falla: si alt_score falla en su v4 pre-asignado, no hay row v4 (alt_score) y la saga row aterriza directamente en v4 (siguiente version libre, no v5). El state page maneja esto buscando por `createdByAgent`, no por version contigua. Documentado en el test del orchestrator.
- Si dos agentes paralelos quisieran escribir en el **mismo** namespace bajo `contribution`, colisionarian. ADR-0004 ya lo previene (cada agente namespacea bajo su nombre); slice 5 lo confirma con bureau y alt_score.

## Alternatives considered

- **Wall-clock order.** Rechazado: tests flaky, UI tiene que ordenar para mostrar de forma estable.
- **LangGraph formal con `addEdge` para fan-out/join.** Rechazado para slice 5: no necesitamos branching condicional, no necesitamos joins con merge custom — tenemos un fan-out paralelo que se rejoinea por el orden de la pipeline. Cuando llegue branching condicional o cycles, abrimos el ADR de migracion.
- **Builder fluido `pipeline().then(a).parallel(b, c)`.** Rechazado: API mas grande, expresividad identica al array de array.
- **AggregateError cuando dos ramas paralelas fallan en el mismo step.** Rechazado: oscurece el primer error y obliga al caller a desempacar. Ya tenemos clases explicitas (`OperationalError` / `DomainError`) que llevan el primer fallo a la saga; eso es suficiente.

## Notes

- Hoy `defaultPipeline = [identity, income, [bureau, alt_score]]`. Slices futuros que agreguen agentes en paralelo (ej. `[policy, decision]` si decisionAgent puede correr concurrente con un policy verifier) heredan el mismo mecanismo sin cambios al orchestrator.
- El test `parallel branch one failing does NOT change the other branch version` en `orchestrator.test.ts` es la regression que protege esta decision: si alguien refactoriza y vuelve a wall-clock order, ese test falla.
