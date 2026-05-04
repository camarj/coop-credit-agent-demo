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
| Lenguaje | TypeScript 5.x (Node 22 LTS, fijado en `.nvmrc` + `engines`) |
| Package manager | pnpm (fijado en `packageManager` de `package.json`) |
| Frontend | Next.js 15 (App Router) + React 19 |
| UI components | Tailwind + shadcn/ui |
| Orchestration | LangGraph.js |
| LLM client | Anthropic SDK (Claude) |
| Schemas | Zod |
| ORM | **Drizzle** (decidido) |
| Database local | Postgres 16 via Docker Compose, imagen `pgvector/pgvector:pg16` (pgvector pre-cargado) |
| Database cloud | **Neon** (decidido) — branching nativo + integracion Vercel + sin features sobrantes |
| Postgres driver | `pg` standard via pooled connection (`-pooler` hostname). `@neondatabase/serverless` queda nota para v2 si alguna route migra a edge runtime |
| Vector store | pgvector en mismo Postgres (mismo image local + Neon lo soporta out-of-box) |
| Migrations | `drizzle-kit` con archivos en `db/migrations/` versionados en git, apply via `pnpm db:migrate` |
| Tracing | Langfuse (cloud free tier) |
| Tests | Vitest + Playwright |
| Test DB | Mismo Postgres local con truncate entre tests (no testcontainers en slices iniciales) |
| E2E env | Docker Compose |
| Estructura del repo | Single Next.js project (no monorepo, no turborepo) |
| Deploy | Vercel (UI + API) + Neon (DB con branch por PR via integration) |

## Decisiones de open questions

### Drizzle vs Prisma → **Drizzle**

Razones:
- TS-first sin codegen pesado — flujo iterativo se mantiene rapido sin "esperar codegen" entre cambios de schema
- SQL-like queries — apropiado para una tabla append-only donde queremos visibilidad sobre que SQL se ejecuta. Futuro lector entiende la consulta sin abrir docs
- Migrations son SQL planos — permite enforce del invariante append-only via trigger en migration explicita (rechaza UPDATE en `application_states`)
- `drizzle-kit studio` como herramienta pedagogica de demo: en webinar se abre Studio en pestana y se ve `application_states` creciendo en tiempo real

### Supabase vs Neon → **Neon**

Razones:
- Branching nativo: una rama de DB por PR/preview deploy, encaja con flujo de vertical slices Pocock — cada slice se prueba contra DB real aislada antes de mergear
- Integracion oficial Vercel ↔ Neon provisiona branches automaticamente por preview, cero setup manual
- Ningun feature de Supabase nos servia: no hay auth (es demo), no hay storage, no hay realtime (usamos SSE propio para el grafo), no hay edge functions. Pagar peso conceptual de Supabase para usar solo Postgres = overkill
- `pgvector` disponible out-of-box
- Free tier generoso para demo publico

**Trade-off conocido:** cold starts de Neon (~sub-segundo en primer request despues de inactividad). Mitigar con warmup ping antes de sesiones de pitch. No es bloqueante.

### Vercel AI SDK vs Anthropic SDK directo → **PENDIENTE**

No bloquea las primeras slices (intake no llama LLM). Se resuelve cuando llegue la slice del agente `policy` o `decision`. Default tentativo: Anthropic SDK directo para no agregar abstraccion innecesaria, salvo que necesitemos features especificos del Vercel AI SDK (streaming helpers, tool calling helpers).
