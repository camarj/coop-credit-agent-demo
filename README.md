# coop-credit-agent-demo

> A production-grade multi-agent system for microcredit decisioning at credit unions in Ecuador. Built as a reference implementation showcasing what separates an AI agent demo from a system you can actually run in production.

## What this is

A working demo of a multi-agent AI system that processes microcredit applications end-to-end:

- **Input:** loan application (national ID, declared income, requested amount and term)
- **Output:** suggested decision (`APPROVED` / `REJECTED` / `REVIEW`) with cited reasons, confidence score and full audit trail
- **Pipeline:** orchestrator coordinates 5-7 specialized agents (identity verification, income verification, credit bureau check, alternative scoring, policy evaluation, final decision) — all with mocked external services so the demo runs anywhere

## Why it exists

Most public AI agent demos are smart-looking scripts. They break the second you put them in front of a real workflow with real failures, real auditability requirements and real users who don't trust black boxes.

This repo is the opposite — a reference for what production-grade looks like:

- Explicit orchestration (not implicit choreography)
- Immutable versioned state (no race conditions)
- Strict data contracts at every agent boundary
- Circuit breakers for external services
- Saga-style compensation for partial failures
- Full tracing and observability
- Evals against ground truth
- A real UI a non-technical reviewer can actually use

## Architecture in one paragraph

A central orchestrator (LangGraph.js) runs a directed graph of specialized agents. Each agent has a strict Zod schema for input and output, an `execute()` method, and a `compensate()` method. When an agent finishes, it produces a new immutable state snapshot — it never mutates an existing one. External calls (mocked credit bureau, social security, civil registry) are wrapped in circuit breakers. If any critical agent fails, the orchestrator walks back through completed agents calling `compensate()` to undo side effects. Every step is traced (Langfuse) and the resulting decision carries its complete reasoning chain.

## Built on

- **TypeScript** + **Next.js 15** + **React 19** (UI and API)
- **LangGraph.js** (orchestration)
- **Zod** (data contracts)
- **Postgres + pgvector** (versioned state + RAG over credit policy docs)
- **Anthropic SDK** (Claude as the LLM behind the agents)
- **Langfuse** (tracing and observability)
- **Vitest + Playwright** (testing)
- **Docker Compose** (local dev)
- **Vercel + Railway** (deploy)

## What this is NOT

- Not a real credit decisioning system. The decision is "suggested" — a human officer always approves.
- Not connected to real credit bureaus or government APIs. Everything is mocked with realistic responses including failures and latency.
- Not multi-tenant, no auth, no payments. It's a demo of the agent architecture, not a SaaS.
- Not a framework or library to install. It's a blueprint to fork and adapt.

## Source material

Based on three deep dives into what separates production agents from demos:

- [From Chaos to Choreography — Sandipan Bhaumik (Databricks)](https://www.youtube.com/) — multi-agent failure modes and the patterns that fix them
- [7 Skills to Build AI Agents — IBM Technology](https://www.youtube.com/) — the actual skill set required beyond prompt engineering
- [Harness Engineering — Mitchell Hashimoto via TRAE](https://x.com/) — the discipline of building deterministic shells around non-deterministic models

Built using [Matt Pocock's skills for real engineers](https://github.com/mattpocock/skills) as the development methodology.

## Status

Early scaffolding. PRD and first vertical slice in progress.

## Run it locally

_Coming soon — once the first vertical slice ships._

## License

MIT

---

Built by [Raul Camacho](https://github.com/) at [Inteliside](https://inteliside.com/) — a software studio in Guayaquil, Ecuador.
