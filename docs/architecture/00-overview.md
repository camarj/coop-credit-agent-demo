# Arquitectura — Overview

> Vision de alto nivel de la arquitectura. Para detalles concretos, ver los ADRs en `docs/adr/`.

## Diagrama logico

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI (Next.js)                            │
│  ┌──────────────┐  ┌──────────────────┐  ┌─────────────────┐    │
│  │ Form de     │  │ Visualizador     │  │ Tablero de      │    │
│  │ solicitud   │  │ del grafo (live) │  │ decisiones      │    │
│  └──────┬───────┘  └────────▲─────────┘  └────────▲────────┘    │
└─────────┼────────────────────┼─────────────────────┼────────────┘
          │ POST               │ SSE/WS              │ GET
          ▼                    │                     │
┌─────────────────────────────────────────────────────────────────┐
│                       API Routes (Next.js)                      │
│  POST /api/applications        GET /api/traces/:id              │
└─────────┬───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Orchestrator (LangGraph.js)                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Grafo:                                                 │    │
│  │   intake → identity → income → bureau ─┐                │    │
│  │                                        ├→ policy → decide│   │
│  │                                  alt_score ┘            │    │
│  │                                                         │    │
│  │  Cada arista valida output del previo con Zod schema    │    │
│  │  Cada nodo wrappeado en circuit breaker si llama mock   │    │
│  │  Si falla critico → camina hacia atras llamando         │    │
│  │  compensate() en orden inverso (saga)                   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─┬──────┬──────┬──────┬──────┬──────┬───────┬────────────────────┘
  │      │      │      │      │      │       │
  ▼      ▼      ▼      ▼      ▼      ▼       ▼
┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐ ┌──────────┐
│ AG ││ AG ││ AG ││ AG ││ AG ││ AG │ │  Tracer  │
│int ││iden││inco││bure││alts││poli│ │ Langfuse │
└─┬──┘└─┬──┘└─┬──┘└─┬──┘└─┬──┘└─┬──┘ └──────────┘
  │     │     │     │     │     │
  ▼     ▼     ▼     ▼     ▼     ▼
 ┌─────────────────────────────────┐
 │  Postgres (state + RAG + meta)  │
 │  - application_states (append)  │
 │  - circuit_breaker_events       │
 │  - rag_chunks (pgvector)        │
 │  - traces_summary               │
 └─────────────────────────────────┘
                  │
                  ▲
 ┌─────────────────────────────────┐
 │      Mocks (services/mocks/)    │
 │  - RegistroCivil  - IESS        │
 │  - Equifax        - AltScore    │
 └─────────────────────────────────┘
```

## Componentes

### Orchestrator
- **Que es:** un grafo de LangGraph.js que define la secuencia de agentes y las transiciones
- **Responsabilidad:** mantener el estado canonico de la solicitud, decidir el siguiente agente, manejar fallos via saga
- **Donde vive:** `src/orchestrator/`

### Agentes
- **Cuantos:** ~7 (intake, identity, income, bureau, alt_score, policy, decision)
- **Estructura comun:** cada uno expone `inputSchema`, `outputSchema`, `execute()`, `compensate()`
- **Donde viven:** `src/agents/{nombre}/`
- **Reglas:** ver `.claude/rules/agent-architecture-principles.md`

### Mocks
- **Que son:** simulaciones de APIs externas con modos configurables (happy/slow/error)
- **Donde viven:** `src/services/mocks/`
- **Justificacion:** ver `docs/adr/0002-mocked-external-services.md`

### Estado versionado
- **Que es:** tabla `application_states` append-only en Postgres
- **Por que:** evitar race conditions (ver Bhaumik). Cada agente produce un nuevo registro, nunca modifica.
- **Schema:** `id`, `application_id`, `version`, `created_by_agent`, `created_at`, `data jsonb`

### RAG sobre politica de credito
- **Que es:** PDF/markdown de politica interna de cooperativa (sintetico) chunkeado, embeddeado y guardado en pgvector
- **Quien lo usa:** el agente `policy`
- **Donde vive:** `src/rag/` + tabla `rag_chunks` en Postgres

### Tracing
- **Stack:** Langfuse (cloud free tier)
- **Que se trazea:** cada llamada a agente, cada llamada a tool, cada llamada al LLM, cada decision
- **Como se ve en UI:** cada solicitud en el tablero tiene link al trace completo

### UI
- **Pieza 1 — Form de solicitud:** captura los datos minimos para iniciar una solicitud (cedula, ingresos, monto, plazo)
- **Pieza 2 — Visualizador del grafo en vivo:** muestra el grafo de LangGraph con cada nodo cambiando de color segun estado (PENDING/RUNNING/COMPLETE/FAILED), conexion via SSE o WebSocket
- **Pieza 3 — Panel de trace por agente:** drill-down a cada agente: input, output, latencia, tokens, costo
- **Pieza 4 — Tablero de decisiones:** lista de solicitudes procesadas con filtros (decision, fecha, oficial), exportable

## Flujo de una solicitud (happy path)

1. Usuario llena form → POST /api/applications
2. API crea registro inicial en `application_states` con version=0, agent="intake"
3. API dispara orchestrator (async, devuelve application_id inmediato)
4. UI redirige al visualizador, conecta SSE a /api/applications/:id/stream
5. Orchestrator corre intake → produce state v1 → emite evento SSE
6. Orchestrator corre identity (envuelto en breaker) → state v2 → SSE
7. ... continua por cada agente, cada uno produciendo nuevo state version
8. Orchestrator llega a policy (RAG) → state v6
9. Orchestrator llega a decision → state v7 con `decision: APPROVED|REJECTED|REVIEW`
10. UI muestra decision final + trace completo + razones citadas

## Flujo de una solicitud (failure + saga)

1-5: igual que happy path
6. Orchestrator corre bureau, breaker se abre tras 5 fallos → bureau falla
7. Orchestrator decide: critico o no?
8. Si critico → walks back: compensate(alt_score), compensate(income), compensate(identity), compensate(intake)
9. Marca solicitud como `state v?` con `terminated: true`, `reason: "bureau_unavailable"`
10. UI muestra: "no se pudo procesar — saga ejecutada exitosamente, sin efectos colaterales"

## Lo que aun no esta decidido (sale del grilling)

- ¿Cuantos agentes exactos van en el MVP vs full demo?
- ¿El visualizador del grafo en vivo va en la primera vertical slice o se agrega despues?
- ¿RAG va en MVP o se agrega en slice posterior?
- ¿Postgres local con Docker o Supabase desde el inicio?
- ¿Vercel AI SDK como capa adicional o llamar Anthropic SDK directo?
- ¿Issue tracker: GitHub Issues, Linear, o `.scratch/` markdown?
