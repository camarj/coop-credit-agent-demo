# ADR-0001 — Stack base: TypeScript + LangGraph.js + Next.js + Postgres

**Status:** Accepted
**Date:** 2026-05-03
**Deciders:** Raul Camacho, Cortex (advisor)

---

## Context

El proyecto necesita un stack para construir un demo multi-agente de produccion con UI, persistencia, RAG y observabilidad. El stack debe ser:

- Familiar para Raul (mantenibilidad post-demo)
- Apto para deploy publico (Vercel-friendly)
- Con ecosistema maduro para multi-agente
- Que doble como blueprint reusable para futuros proyectos similares de Inteliside

## Opciones consideradas

### Opcion A — Python: LangGraph + FastAPI + Postgres + Streamlit/Reflex

**Pros:**
- LangGraph es nativo Python, mas maduro
- Mejor ecosistema para credit/financial libraries (numpy, scipy, sklearn si se necesita)
- Mejor documentacion para tracing con Langfuse
- Mocks de servicios externos faciles con `pytest-httpx`

**Cons:**
- Stack ajeno al resto de Inteliside (todo es Next.js/TS)
- UI en Python = compromiso (Streamlit es feo para demos comerciales, Reflex menos maduro)
- Deploy mas complejo (no es un click en Vercel)
- Mantenimiento futuro friccionado (Raul programa diario en TS)

### Opcion B — TypeScript: LangGraph.js + Next.js + Postgres + Vercel AI SDK

**Pros:**
- Stack consistente con Inteliside (Next.js, TS, Supabase, etc.)
- UI premium "out of the box" con shadcn/ui
- Deploy a Vercel sin friccion
- Mantenimiento futuro alineado con flujo diario
- Vercel AI SDK + LangGraph.js cubren el caso completo

**Cons:**
- LangGraph.js es port mas joven que el Python original — algunos features podrian llegar tarde
- Ecosistema de evals/observability menos rico que Python (pero suficiente)
- Menos ejemplos publicos de multi-agente complejo en TS

## Decision

**Opcion B — TypeScript stack completo.**

## Rationale

1. **Consistencia con el ecosistema Inteliside.** Todo lo que Raul construye es Next.js/TS. Mantener un stack ajeno solo para este proyecto introduce friccion permanente sin beneficio tecnico que justifique.
2. **El demo dobla como asset publico y blueprint.** Si futuros clientes ven el repo y lo quieren adaptar, lo van a hacer en TS porque ese es el stack default de Inteliside.
3. **Vercel deploy.** Cero friccion para mantener el showroom publico arriba.
4. **LangGraph.js esta production-ready.** Los features faltantes vs Python no son bloqueantes para este caso de uso.
5. **El ecosistema TS para agentes esta madurando rapido.** Vercel AI SDK + LangGraph.js + Langfuse cubren el caso.

## Consequences

### Positivas

- Stack coherente con el resto de Inteliside
- UI de calidad sin esfuerzo
- Deploy trivial
- Mantenimiento futuro sin context switching

### Negativas

- Si LangGraph.js queda atras de Python en algun feature critico, podria toca portear o forkear
- Menos ejemplos publicos de inspiracion para casos complejos

### Mitigacion

- Encapsular el orchestrator detras de una interfaz propia que esconda LangGraph. Si en el futuro hay que migrar, solo cambia la implementacion del orchestrator, no los agentes.

## Stack final

| Capa | Tecnologia |
|---|---|
| Lenguaje | TypeScript 5.x |
| Frontend | Next.js 15 (App Router) + React 19 |
| UI components | Tailwind + shadcn/ui |
| Orchestration | LangGraph.js |
| LLM client | Anthropic SDK (Claude) |
| Schemas | Zod |
| ORM | Drizzle |
| Database | Postgres 16 (local Docker, prod Supabase o Neon) |
| Vector store | pgvector (mismo Postgres) |
| Tracing | Langfuse (cloud free tier) |
| Tests | Vitest + Playwright |
| E2E env | Docker Compose |
| Deploy | Vercel (UI + API) + Supabase/Neon (DB) |

## Open questions

- Drizzle vs Prisma — pendiente de decision en grilling. Default Drizzle por TS-firstness y por ser el que Raul usa en otros proyectos.
- Supabase vs Neon — pendiente. Default Supabase por familiaridad y por features extra (storage, realtime).
- Vercel AI SDK como capa adicional, o llamar Anthropic SDK directo — pendiente. Default: Anthropic SDK directo para no agregar abstraccion innecesaria, salvo que necesitemos features especificos del Vercel AI SDK (streaming, tool calling helpers).
