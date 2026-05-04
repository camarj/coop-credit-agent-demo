# Vertical slices, no capas horizontales

Pocock odia la "codificacion horizontal" (hacer toda la DB primero, despues toda la API, despues todo el UI). En este proyecto esta prohibida.

## Regla dura

**Cada feature se implementa como una rebanada vertical que toca todas las capas relevantes y produce algo demostrable end-to-end.**

## Por que

- Feedback loop corto — sabes inmediatamente si tu enfoque va bien o mal
- Demo-able en cualquier momento — el demo se construye gradualmente, no esperando 3 sprints
- Reduce el riesgo de descubrir un mismatch entre capas al final
- Permite paralelizar (otra slice independiente puede correr en paralelo)

## Como se ve una vertical slice en este proyecto

Una slice tipica toca:

1. **Schema Zod** del input/output del agente
2. **Implementacion del agente** (execute + compensate)
3. **Persistencia de estado** versionado en Postgres
4. **Wiring en el orchestrator** (LangGraph)
5. **Tracing emitido** a Langfuse
6. **API route** que dispara el flow
7. **Pieza de UI** que muestra el resultado de esa etapa
8. **Test E2E** que cubre el happy path de la slice

Si una "feature" deja sin tocar 3 de esos 8 puntos, probablemente es una capa horizontal disfrazada.

## Anti-patrones a evitar

- "Primero hacemos toda la DB" — NO
- "Primero hacemos todos los agentes mock, despues conectamos" — NO
- "Primero el backend completo, despues el frontend" — NO
- "Vamos a setear todo el observability primero" — NO
- "Hagamos los Zod schemas de todos los agentes y despues implementamos" — NO

## Como cortar bien una slice

Cada slice debe responder afirmativamente a:

- ¿Un usuario puede ver/usar algo nuevo despues de mergear esto?
- ¿Esta slice puede demostrarse en aislamiento (sin las otras)?
- ¿Tiene un test E2E que prueba el caso?
- ¿No bloquea innecesariamente otras slices?

## Ejemplos de buenas slices para este proyecto

- **Slice 1:** "Solicitud minima → identidad mock → respuesta basica con UI form"
  (toca: schema, agente, DB, orchestrator vacio, route, form simple, test)
- **Slice 2:** "Agregar verificacion de bureau con circuit breaker visible"
  (toca: nuevo agente, breaker, UI muestra estado del breaker, test)
- **Slice 3:** "Agregar policy evaluator con RAG"
  (toca: pgvector setup, embeddings de PDF politica, agente nuevo, UI muestra fuentes, test)

## Para romper un PRD en slices

```
/to-issues
```

Esta skill convierte un PRD en issues independientemente atrapables, cada una como una vertical slice.
