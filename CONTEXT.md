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
El conjunto de reglas internas de la cooperativa que determinan si una solicitud califica. Vive como PDF/markdown sintetico para el demo. Es el corpus del RAG.
_Avoid:_ reglamento, normativa

**Monto:**
La cantidad solicitada en USD (Ecuador usa dolar americano).

**Plazo:**
Numero de meses para pagar el credito.

### Terminos del sistema

**Agente:**
Un componente con responsabilidad unica que recibe estado, hace su trabajo y produce nuevo estado. Inputs y outputs validados con Zod schema. Tiene `execute()` y `compensate()`.
_Avoid:_ servicio, modulo, worker

**Orchestrator:**
El componente central que coordina la secuencia de agentes. Mantiene el grafo de ejecucion. Es la unica entidad con vision completa del flujo. Implementado con LangGraph.js.
_Avoid:_ coordinator, manager, controller

**Estado (state):**
Un snapshot inmutable de la solicitud en un punto del flujo. Cada agente produce un nuevo estado, nunca modifica uno existente. Tiene `version`, `created_by_agent`, `created_at`, `data`.
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

**Tool:**
Una funcion que un agente LLM puede invocar. Tiene schema Zod estricto para input y output. NO confundir con "agente" — un agente puede usar varios tools.

**allowedTools:**
Lista explicita de tool names que cada agente puede invocar. Declarada en `agents/{name}/config.ts`. Guard en runtime emite `UnauthorizedToolError` si un agente intenta usar un tool fuera de su lista. Ej: `policy.allowedTools = ['rag.retrieve', 'rag.rerank']`.

**Confidence:**
Numero en `[0, 1]` adjunto a cada `Decision`. **Es funcion deterministica de las senales upstream** (resultados de los agentes anteriores) — NO es autoasignada por el LLM. El LLM solo redacta la justificacion en lenguaje natural.

**Confidence threshold:**
Umbral configurable (default `0.75`, env var `CONFIDENCE_THRESHOLD`). Si `confidence < threshold`, la `Decision` se marca para escalar a oficial humano explicitamente — la decision sigue siendo "sugerida" pero la UI la presenta distinta.

**Token budget:**
Limite hard de tokens (input + output) consumibles por una `Solicitud` completa. Default `50_000`, env var `TOKEN_BUDGET_PER_APPLICATION`. Si la suma excede, el orchestrator detiene la pipeline, marca la solicitud como `REVIEW` con razon `token_budget_exceeded`, y dispara la saga.

**Idempotency key:**
UUID generado client-side incluido en cada submit de solicitud. Constraint `UNIQUE` en DB previene duplicados ante doble-click o retries de red. Si llega un submit con un key ya procesado, el API devuelve la decision existente sin re-procesar.

**Hard inquiry:**
Efecto colateral simulado de `EquifaxMock.requestHardPull()`. Cada pull registra un hard inquiry en el estado interno del mock; los hard inquiries acumulados afectan el `score` en pulls futuros. Reversible via `compensate()` del agente `bureau` — esto es lo que hace que la saga sea **real, no teatral**.

**Razonamiento (streaming):**
Eventos estructurados que un agente emite durante su ejecucion (NO son tokens del LLM streamed, son discretos): `{ agent, step, message }`. Llegan a la UI via SSE y se muestran en un panel lateral por nodo activo. Hace visible el "pensar en voz alta" del sistema.

### Mocks de servicios externos

**RegistroCivilMock:**
Simula la API del Registro Civil de Ecuador para validar cedula. Devuelve nombres, fecha de nacimiento, lugar de nacimiento.

**IessMock:**
Simula la API del IESS (seguridad social EC) para verificar afiliacion laboral, sueldo declarado, antiguedad.

**EquifaxMock:**
Simula buro de credito. Devuelve score, historial de pagos, deudas vigentes.

**ScoreAlternativoMock:**
Simula un servicio de scoring alternativo (sin reportar, basado en patrones de gasto sintetizados).

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
