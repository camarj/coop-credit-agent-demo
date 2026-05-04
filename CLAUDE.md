# CLAUDE.md — coop-credit-agent-demo

> Tu eres el agente de Claude Code asignado a este proyecto. Lee este archivo completo antes de hacer cualquier cosa.

---

## Que estamos construyendo

**Demo de produccion de un agente de IA para otorgamiento de microcredito en cooperativas de Ecuador.**

El demo es **un asset reusable** con tres usos paralelos:

1. **Webinar tecnico** — Raul lo presenta en vivo explicando como debe disenarse un agente apto para produccion
2. **Pitch a clientes** — se abre en llamada de venta, prospect ve un caso real corriendo, sirve de prueba de capacidad de Inteliside
3. **Asset publico** — vive en el repositorio personal de Raul, sirve como pieza de marca tecnica y como blueprint reusable para futuros proyectos similares

NO es un prototipo desechable. NO es solo material de slides. Es un sistema funcional con UI que se puede demostrar en vivo y adaptar a otros casos.

---

## Por que microcredito en cooperativa EC

- **Caso de estudio textual** de la charla de Sandipan Bhaumik (Databricks) sobre por que los sistemas multi-agente fallan en produccion. La charla cuenta como un sistema similar aprobo el 20% de creditos mal por una caché desactualizada.
- **Industria regulada** que exige trazabilidad, auditoria y explicabilidad — todas las cosas que un agente de produccion debe tener.
- **Mercado EC accesible:** las cooperativas grandes (JEP, Jardin Azuayo, Policia Nacional, Coopmego) tienen presupuesto, ciclos de venta cortos y son innovadoras.
- **Numeros EC ancla:** oficial de credito $1,200-1,500/mes, procesa 8-12 solicitudes/dia, cooperativa media 50-100 solicitudes/dia.
- **Risk-zero como demo:** el sistema emite "decision sugerida + justificacion" para que un oficial humano apruebe. No toma decisiones reales con dinero.

---

## Criterio de exito tecnico

El demo DEBE cumplir con todo lo siguiente. Cualquier feature que se proponga debe poder mapearse a uno de estos items, o no entra.

### 7 skills de IBM (articulo fuente: `~/Documents/Cortex/output/articulos-youtube/2026-05-03-7-skills-build-ai-agents-ibm.md`)

1. **System design** — orchestrator central + agentes especializados con responsabilidad unica
2. **Tool & contract design** — schemas estrictos (Zod) en frontera de cada agente, ejemplos en docs, tipos required
3. **Retrieval engineering** — RAG sobre politica de credito de la cooperativa (PDF sintetico), chunking + re-ranking
4. **Reliability engineering** — circuit breakers, retries con backoff, timeouts, fallback paths
5. **Security & safety** — input validation contra prompt injection, PII redaction en logs, permission boundaries entre agentes, sandbox de tool calls
6. **Evaluation & observability** — tracing completo (Langfuse), dataset de casos con ground truth, tests automatizados de regresion
7. **Product thinking** — UI que muestra confianza, fuentes citadas, escalation a humano cuando confidence < umbral, manejo elegante de errores

### Patrones de Bhaumik (articulo fuente: `~/Documents/Cortex/output/articulos-youtube/2026-05-02-from-chaos-to-choreography-sandipan-bhaumik.md`)

- **Orchestration over choreography** — grafo explicito (LangGraph TS o equivalente). Justificado: industria regulada → necesita trazabilidad central
- **Estado inmutable con versiones** — tabla append-only. Cada agente produce snapshot nuevo con `version` y `created_by_agent`. Nadie modifica registros existentes.
- **Contratos de datos** — validacion en frontera. Si un agente recibe data por debajo del umbral de confianza, rechaza la entrega.
- **Circuit breakers** — demostrable en vivo. Tumbamos un mock, breaker se abre tras N fallos, falla rapido, half-open despues de cooldown.
- **Saga / compensation** — cada agente tiene `execute()` y `compensate()`. Orchestrator reverte hacia atras si una etapa critica falla.

### Principios Harness Engineering (articulo fuente: `~/Documents/Cortex/output/articulos-x/2026-05-02-harness-engineering-trae.md`)

- **R.E.S.T.** — Reliability + Efficiency + Security + Traceability
- **REPL determinista que envuelve el LLM** — el LLM es unidad de computo sin estado, todo el estado vive fuera
- **Control plane vs data plane** — separacion entre logica de orquestacion y ejecucion
- **Diseno para el fracaso** — los fallos son la norma, no la excepcion

---

## Stack tecnico (decidido)

- **Lenguaje:** TypeScript (no Python), Node 22 LTS pinneado
- **Package manager:** pnpm
- **Frontend:** Next.js 15 + React 19 + Tailwind + shadcn/ui
- **Orchestrator:** LangGraph.js (puerto TS de LangGraph)
- **LLM:** Claude (Anthropic SDK). Vercel AI SDK como capa: pendiente de decision
- **Validacion de schemas:** Zod
- **ORM:** Drizzle (con `drizzle-kit` para migrations versionadas)
- **DB local:** Postgres 16 en Docker Compose con imagen `pgvector/pgvector:pg16`
- **DB cloud:** **Neon** (branching por PR via integracion Vercel)
- **RAG:** pgvector en el mismo Postgres
- **Observabilidad:** Langfuse (cloud free tier para el demo, self-hosted opcional)
- **Tests:** Vitest + Playwright (E2E del flow completo)
- **Deploy publico:** Vercel (UI + API) + Neon (DB)
- **Estructura del repo:** Single Next.js project (no monorepo)

Para detalles y rationale ver `docs/adr/0001-typescript-langgraph-stack.md`.

---

## Metodologia de desarrollo: flujo Pocock

Este proyecto sigue el flujo de Matt Pocock para coding asistido por IA. **NO codear sin alinear primero.**

### Skills disponibles (en `.claude/skills/`)

Todas las skills viven directamente bajo `.claude/skills/{nombre}/SKILL.md`.

**Para alinear y planificar:**
- `/grill-me` — Cuando Raul quiere ser entrevistado sin piedad sobre un plan o decision. Para decisiones no-codigo.
- `/grill-with-docs` — Igual a grill-me pero ademas actualiza CONTEXT.md y crea ADRs sobre la marcha. **Esta es la skill default para alinear sobre features tecnicas.**
- `/to-prd` — Convertir la conversacion actual en un PRD. Usar al final de una sesion de grill.
- `/to-issues` — Romper un PRD en issues independientemente atrapables, usando vertical slices.
- `/triage` — Mover issues por la maquina de estados de triage.

**Para implementar:**
- `/tdd` — Red-green-refactor loop. **Obligatorio para escribir codigo de produccion.**
- `/diagnose` — Loop disciplinado de diagnostico para bugs duros: reproducir → minimizar → hipotetizar → instrumentar → fix → test de regresion.
- `/improve-codebase-architecture` — Buscar oportunidades de hacer modulos mas profundos. Correr cada pocos dias.
- `/zoom-out` — Pedir al agente vision de mas alto nivel cuando el codigo desconocido confunde.

**Setup y meta:**
- `/setup-matt-pocock-skills` — Ejecutar UNA VEZ al inicio. Configura issue tracker, labels, ubicacion de docs.
- `/caveman` — Modo de comunicacion ultra comprimido (-75% tokens) cuando hay que ser eficiente.
- `/write-a-skill` — Crear nueva skill cuando se identifica un patron repetible.

### Flujo tipico para cada feature

1. **Alinear:** `/grill-with-docs` — entrevista hasta concepto compartido + actualiza CONTEXT.md + crea ADRs si hay decisiones arquitectonicas
2. **Documentar:** `/to-prd` — convierte la sesion en PRD persistido en issues
3. **Romper:** `/to-issues` — divide el PRD en vertical slices independientes
4. **Implementar:** `/tdd` — red-green-refactor por cada slice
5. **Revisar arquitectura:** `/improve-codebase-architecture` periodicamente
6. **Si hay bug:** `/diagnose`

### Reglas duras del flujo Pocock

- **Vertical slices, NO capas horizontales.** Cada slice toca DB + logica + UI y produce algo demostrable. NO se construye toda la DB primero, despues toda la API, despues todo el UI.
- **TDD no es opcional.** Test rojo primero, codigo verde despues, refactor. El agente NO escribe codigo sin tener test que falle.
- **Modulos profundos sobre modulos superficiales.** Pocas interfaces simples que esconden complejidad, no 50 archivitos enredados entre si.
- **Push vs pull de reglas:**
  - **Pull para implementar:** el agente busca reglas cuando las necesita (este CLAUDE.md + skills + CONTEXT.md)
  - **Push para revisar:** el agente revisor (PR review) tiene reglas siempre cargadas en el system prompt

---

## Design system de la UI

La UI usa el **Inteliside Design System v2 (Editorial, inspirado en Anthropic)** en **Modo Light**. Specs concretos, tokens, configuracion de Tailwind/shadcn, y reglas visuales viven en `.claude/rules/inteliside-design-light.md`. Lectura obligatoria antes de tocar cualquier componente UI.

**Fuente de verdad canonica:** `~/.claude/skills/inteliside-design/` (skill global de Claude Code, symlink a `~/Documents/Inteliside/Design-System-v2/`). Incluye `colors_and_type.css` con tokens autoritativos, `preview/*.html` con componentes en vivo, y `ui_kits/` con landings/decks/docs de referencia.

**Resumen de un parrafo:** fondo ivory warm `#F5F1EB` (NO blanco puro), texto warm ink `#141210`, acento teal `#2D9AA5` (links/CTA/eyebrows). Tipografia obligatoria: Fraunces (serif para H1/H2/lead/italics) + Geist (sans para body/H3/H4) + Geist Mono (eyebrows uppercase). Hairlines en vez de shadows. Border-radius 6px botones, 10px cards. Iconos Solar linework. Patron editorial-meta caracteristico. Maximo 3 colores en una vista. Sin emojis. Copy espanol segunda persona informal.

**Importante:** este sistema (v2) es DISTINTO al manual de marca v1.0 (`~/Documents/Inteliside/Manual-Marca-Corporativo-Inteliside-v1.0.md`). El v1 esta deprecado para esta UI — no usar sus tokens.

---

## Reglas duras del proyecto

1. **Codigo en ingles, comentarios en espanol cuando agreguen contexto** (que NO es la mayoria de las veces — preferir nombres autoexplicativos)
2. **Nada de mocks que mientan.** Los mocks de servicios externos (Equifax, IESS, Registro Civil) deben simular respuestas verosimiles, incluyendo casos de fallo, latencias y errores. Esto es CRITICO porque el demo sirve para mostrar circuit breakers y sagas.
3. **Toda decision arquitectonica > trivial va a un ADR** en `docs/adr/`. Formato: ADR-NNNN-titulo-corto.md
4. **Toda jerga del dominio se documenta en `CONTEXT.md`** la primera vez que aparece. Esto es lenguaje compartido entre Raul, agente y futuros lectores.
5. **No tocar archivos fuera del proyecto** sin autorizacion explicita.
6. **Commits con mensaje claro en ingles.** Formato: `tipo: descripcion corta` (feat/fix/docs/test/refactor/chore).
7. **NUNCA hacer push, force push, o cualquier comando destructivo de git sin pedir confirmacion.**
8. **UI sigue el design system de Inteliside Modo Light** — ver seccion `Design system de la UI` arriba y `.claude/rules/inteliside-design-light.md`.

---

## Lo que NO hace este demo (anti-scope)

- NO toma decisiones reales de aprobacion de credito (es un sistema de "decision sugerida")
- NO conecta a APIs reales de buros (Equifax/BIQ) ni del estado EC (IESS/Registro Civil) — todo mock
- NO maneja pagos ni desembolsos
- NO tiene autenticacion de usuario (es demo, no SaaS)
- NO maneja multi-tenancy
- NO tiene soporte i18n (espanol unicamente)
- NO tiene mobile native (web responsive es suficiente)

---

## Sobre Raul (el usuario)

- Founder de Inteliside (studio de tecnologia, Guayaquil EC)
- Stack habitual: Next.js, TypeScript, Supabase, n8n, Claude Code
- Estilo: directo, tecnico-opinatico, sin relleno
- Prefiere espanol con terminos tecnicos en ingles (deploy, webhook, schema, PR)
- Pregunta antes de ejecutar tareas ambiguas. Presenta plan antes de tareas complejas.
- Lee la voz de marca completa en `~/Documents/Cortex/.claude/docs/references/brand-voice.md`

---

## Articulos fuente (lectura obligatoria al inicio del proyecto)

- `~/Documents/Cortex/output/articulos-youtube/2026-05-03-7-skills-build-ai-agents-ibm.md`
- `~/Documents/Cortex/output/articulos-youtube/2026-05-02-from-chaos-to-choreography-sandipan-bhaumik.md`
- `~/Documents/Cortex/output/articulos-x/2026-05-02-harness-engineering-trae.md`
- `~/Documents/Cortex/output/articulos-youtube/2026-05-02-ai-coding-real-engineers-matt-pocock.md`

---

## Agent skills

### Issue tracker

GitHub Issues en `camarj/coop-credit-agent-demo` via la CLI `gh`. Ver `docs/agents/issue-tracker.md`.

### Triage labels

Cinco labels canonicas (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) creadas en GitHub. Ver `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` en la raiz, ADRs en `docs/adr/`. Ver `docs/agents/domain.md`.

---

## Estado actual del proyecto

**Setup inicial completado.** Pendiente:

1. Sesion `grill-me` con Raul para definir alcance del MVP
2. Crear PRD inicial con `/to-prd`
3. Romper en issues con `/to-issues`
4. Primera vertical slice: solicitud minima → identidad mock → bureau mock → decision basica con UI

---

*Creado: 2026-05-03*
