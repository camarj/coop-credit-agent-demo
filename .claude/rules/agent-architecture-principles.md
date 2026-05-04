# Principios no-negociables de la arquitectura del agente

Este documento codifica las reglas duras de arquitectura del proyecto. Si una propuesta de implementacion viola alguna de estas, rechazala antes de codear.

Las fuentes son las charlas/articulos en `~/Documents/Cortex/output/articulos-*/` sobre Bhaumik, IBM 7 skills y Harness Engineering.

---

## 1. Estado inmutable con versiones — SIEMPRE

**Regla:** ningun agente modifica un estado existente. Cada agente que termina su trabajo produce un nuevo registro de estado con `version = previous + 1`, `created_by_agent = self.name`, y `created_at = now()`.

**Por que:** elimina race conditions. Permite auditoria completa. Permite rollback. Es lo que evita el bug del 20% de creditos mal aprobados que conto Bhaumik.

**Implementacion:**
- Tabla `application_states` append-only en Postgres
- Sin UPDATE statements, solo INSERT
- Schema Zod de cada estado tiene un campo `version: number`
- El orchestrator pasa al siguiente agente la version mas reciente

**Anti-patron:** caché en memoria que se desincroniza con la DB. Si vas a meter caché, debe ser invalidacion estricta o no caché.

---

## 2. Contratos en frontera — SIEMPRE

**Regla:** todo input y output de un agente esta validado por un Zod schema en la frontera. El agente rechaza ejecutar si el input no valida. El orchestrator rechaza propagar si el output no valida.

**Por que:** los problemas de data deben atraparse donde ocurren, no 3 agentes despues cuando todo el reporte ya es basura.

**Implementacion:**
- Cada agente exporta `inputSchema` y `outputSchema`
- El BaseAgent envuelve `execute()` con validacion automatica
- Los schemas tienen ejemplos en JSDoc
- Los schemas usan `.describe()` en cada campo para documentar

**Anti-patron:** "any" o "unknown" en los limites entre agentes. Si necesitas dinamismo, usa `z.discriminatedUnion`.

---

## 3. Orchestration sobre choreography — para este proyecto

**Regla:** todos los agentes son llamados por el orchestrator central (LangGraph). Los agentes NO se llaman entre si.

**Por que:** industria regulada (cooperativas tienen SBS encima) → trazabilidad central no es opcional. La choreography seria mas elegante para sistemas event-driven puros, pero aqui necesitamos un punto unico que sepa el estado completo.

**Implementacion:**
- El grafo de LangGraph esta declarado explicitamente en un solo archivo
- Cada agente es un nodo del grafo
- Las aristas son las transiciones permitidas
- El orchestrator mantiene el estado canonico

**Anti-patron:** event bus implicito donde un agente publica un evento y "alguien" lo recoje. Eso es coreografia y no es lo que estamos construyendo.

---

## 4. Circuit breakers en toda llamada externa — SIEMPRE

**Regla:** toda llamada a un mock externo (Equifax, IESS, Registro Civil) esta envuelta en un circuit breaker.

**Por que:** servicios externos fallan. Los EC mas todavia. Sin breaker, un mock caido tumba toda la solicitud.

**Implementacion:**
- Wrapper `withCircuitBreaker(fn, opts)` que envuelve cualquier funcion async
- Estados: CLOSED → OPEN (tras N fallos) → HALF_OPEN (tras cooldown) → CLOSED o OPEN
- Configurable: `failureThreshold`, `cooldownMs`, `halfOpenMaxCalls`
- El estado del breaker se expone en el trace para visualizacion

**Anti-patron:** retries infinitos. Si quieres retries, define maximo y usalo dentro del breaker.

---

## 5. Saga / compensation para failures de la pipeline — SIEMPRE

**Regla:** todo agente que produce efectos colaterales (lock en bureau, reserva de slot, etc.) implementa `compensate()` que los deshace.

**Por que:** si la solicitud falla en el penultimo paso, no podemos dejar locks colgados ni cobros sin reembolsar. Las cosas externas deben revertirse.

**Implementacion:**
- BaseAgent define `execute(state): NewState` y `compensate(state): void`
- El orchestrator mantiene la lista de agentes que ejecutaron exitosamente
- Si un agente falla criticamente, el orchestrator camina hacia atras llamando `compensate()` en orden inverso
- Los mocks deben simular efectos colaterales reversibles para que se vea en el demo

**Anti-patron:** asumir que "el siguiente reintento limpia lo anterior". No. Compensa explicitamente.

---

## 6. Modulos profundos sobre modulos superficiales — SIEMPRE

**Regla:** cada agente expone una interfaz pequena (1-2 metodos publicos) que esconde toda la complejidad interna. NO crear archivos pequenos enredados entre si.

**Por que:** Pocock + Ousterhout. Codigo malo = muchos archivitos con dependencias enrevesadas. Codigo bueno = pocas interfaces simples que esconden mucha logica.

**Implementacion:**
- Cada agente vive en su propio directorio: `agents/identity/`
- Adentro: `index.ts` (interfaz publica), `internal/` (todo lo demas)
- Solo `index.ts` se importa desde fuera
- Tests viven al lado de lo que prueban

**Anti-patron:** crear `IdentityValidator`, `IdentityFetcher`, `IdentityMapper`, `IdentityCache` como 4 archivos separados con dependencias entre si. Eso es shallow modules. Hacerlo todo dentro del agente con interfaz unica.

---

## 7. El LLM es unidad de computo sin estado — SIEMPRE

**Regla:** el LLM nunca mantiene estado entre turnos. Todo lo que el LLM necesita saber se le pasa explicitamente en cada llamada. El estado vive en Postgres + el orchestrator.

**Por que:** Harness Engineering. Forzar al LLM a mantener estado por prompt engineering = comportamiento caotico e intrazable.

**Implementacion:**
- El context de cada llamada al LLM se construye desde la DB
- No hay "memoria" del LLM entre invocaciones del mismo agente
- Si un agente necesita historial, lo lee de la DB y lo pasa explicitamente

**Anti-patron:** depender de "el modelo se acuerda" o usar threads de OpenAI / messages persistentes. NO.

---

## 8. Todo es medible y trazable — SIEMPRE

**Regla:** cada llamada a un agente, cada llamada a un tool, cada llamada al LLM, cada decision se loguea en Langfuse con metadata completa.

**Por que:** "no puedes mejorar lo que no puedes medir". Sin trazas, debuggear es adivinanza.

**Implementacion:**
- Decorator `@traced` en el BaseAgent
- Spans anidados (orchestrator > agent > tool > llm)
- Metadata: tokens, latencia, costo, decision, version del estado
- IDs propagados a UI para que cada decision tenga link al trace

**Anti-patron:** logging local con `console.log`. NO. Usa el tracer.

---

## 9. Defensa en profundidad de seguridad — SIEMPRE

**Regla:**
- (a) Validacion de input contra patrones de prompt injection antes de pasar al LLM
- (b) PII redaction en logs y traces
- (c) Permission boundaries: el agente de decision NO puede ser llamado directamente, solo por el orchestrator
- (d) Sandbox para tool calls que ejecuten codigo (si los hay)

**Por que:** el agente toca decisiones financieras (aunque sean sugeridas). Es superficie de ataque.

**Anti-patron:** confiar en que "el modelo no va a hacer caso a un prompt injection". Va a hacer caso. Filtra antes.

---

## Checklist antes de mergear

Antes de mergear cualquier feature de un agente:

- [ ] Schema Zod de input + output con `.describe()` en cada campo
- [ ] `execute()` y `compensate()` implementados
- [ ] Llamadas externas envueltas en circuit breaker
- [ ] Tests unitarios del agente con mocks
- [ ] Test de integracion del agente dentro del orchestrator
- [ ] Tracing emite spans con metadata completa
- [ ] No introduce mutaciones de estado existente
- [ ] Documentado en CONTEXT.md si introduce jerga nueva
- [ ] ADR creado si la decision de implementacion es no-trivial
