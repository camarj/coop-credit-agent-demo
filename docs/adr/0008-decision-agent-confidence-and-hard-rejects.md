# ADR-0008 — decisionAgent: hard rejects deterministicos + confidence formula + LLM solo redacta

**Status:** Accepted
**Date:** 2026-05-06
**Deciders:** Raul Camacho

---

## Context

Slice 7 introduce el `decisionAgent`, **nodo final del grafo y output canonico del sistema**. Por primera vez el demo produce una decision sugerida (`APPROVED | REJECTED | REVIEW`) que el oficial humano lee y convierte en accion real.

Este es el momento mas sensible regulatoriamente del producto:

- Una cooperativa supervisada por SBS necesita defender cada rechazo automatico. "El modelo se acordo de citar EXC-001" no firma una auditoria. La logica regulatoriamente critica tiene que vivir en codigo determinista trazable.
- El confidence asignado a cada decision define cuando el sistema escala a humano. Si el LLM autoasigna su propia confidence, el numero es comportamiento emergente — no calibrable, no defendible.
- La inclusion financiera (target del producto) exige que bureau bajo NO sea sentencia automatica. Hay que poder aprobar thin-files con compensadores (alt_score, IESS estable). Eso es lo que distingue una cooperativa moderna de un banco privado.

Cinco decisiones interdependientes que se cierran juntas porque ninguna funciona aisladamente:

1. **Quien produce los hard rejects** (codigo determinista vs LLM vs hibrido).
2. **Que reglas son "constitucionales"** (criterio de inclusion en `preDecide()`).
3. **Formula de confidence** (que senales, que pesos, que defaults).
4. **Mapeo confidence → decision** (umbrales y semantica de los buckets).
5. **Schema del LLM output** (que aporta el LLM, que no aporta).

## Decision

### 1. Arquitectura: `preDecide() → computeConfidence() → LLM`

El `decisionAgent.execute()` corre tres fases en orden:

```ts
async execute(input, ctx) {
  // Fase 1: hard rejects deterministicos (NO llama LLM)
  const hardReject = preDecide(input);
  if (hardReject) return hardReject;

  // Fase 2: confidence deterministico (NO llama LLM)
  const { value, breakdown } = computeConfidence(input);
  const decision = value >= APPROVAL_THRESHOLD ? 'APPROVED' : 'REVIEW';

  // Fase 3: LLM redacta el reason (no la decision, no el confidence)
  const llmResult = await llm.generate(buildPrompt(input, decision, value, breakdown));
  return { decision, decisionType: 'llm_decision', confidence: value, breakdown, ... };
}
```

**Por que.**

- **Regulatoriamente defendible.** Las dos fases deterministicas se pueden ejecutar en una hoja de calculo del auditor. El LLM solo aporta texto.
- **Testeable sin LLM ni DB.** AC del issue: "Funcion pura `computeConfidence(states): number` ... testeable sin DB ni LLM". `preDecide` cumple el mismo principio.
- **Safety net contra LLM errors.** Si Sonnet alguna vez no detecta que hay fallecido en el state, `preDecide` ya rechazo en fase 1 — el LLM nunca llega a ver el caso. La capa determinista es backstop.
- **Cero costo LLM en casos obvios.** Hard rejects responden en 50ms sin tokens.

### 2. Reglas constitucionales: criterio operacional "puede el producto overridear esta regla?"

Una regla entra a `preDecide()` solo si la respuesta es **no** a esta pregunta operacional:

> "¿Puede esta regla ser **overrideada por una variable del producto o del cliente** sin contradecir su justificacion regulatoria/etica?"

El criterio es operacional, no slogan. Aplicacion al caso real:

| Caso | Override del producto? | Constitucional? |
|---|---|---|
| Persona fallecida (EXC-001) | NO. Imposible aprobar a un fallecido bajo cualquier producto cooperativista. Es suplantacion. | **SI — hard reject** |
| Menor de edad (lado menor de EXC-002) | NO. Capacidad legal constitucional ecuatoriana. Sin producto que la sortee. | **SI — hard reject** |
| DTI > 50% (EXC-003 cuando `income.salary` autoritativo) | NO. La razon cuota/ingreso es matematica del riesgo de default — aun con codeudor, el solicitante mismo no puede pagar. La regla no admite override del producto. | **SI — hard reject** |
| Adulto mayor > 75 (lado senior de EXC-002) | SI. Algunas cooperativas ofrecen "Credito Senior" con codeudor obligatorio o seguro de vida pre-pagado. La regla se relaja con configuracion del producto. | NO — soft signal en `age_band` |
| Score Equifax < 500 (SCO-001) | SI. SCO-002 y SCO-003 explicitamente aprueban thin-files con compensadores (alt_score alto + IESS estable). | NO — gradient en `bureau_score` |
| Hard inquiries multiples (MIC-005) | SI. Producto puede aceptar con tasa recargada. | NO — soft signal `hard_inquiries` |

**Regla mnemotecnica:** "Si un PM puede escribir una variante del producto que aprueba este caso de forma defendible, la regla NO es constitucional." Si la respuesta es "depende del producto", va al confidence soft.

Tres reglas constitucionales hoy:

| Regla en codigo | Espejo en corpus | Disparador | Justificacion |
|---|---|---|---|
| `identityFalleсido` | EXC-001 (tags: fraude, fallecido) | `state.identity.valid === false` | Suplantacion de identidad. Reportable al SBS. NO existe caso razonable de aprobar a un fallecido. |
| `menorDeEdad` | mitad "menor" de EXC-002 | edad calculada `< 18` | Capacidad legal constitucional ecuatoriana. Sin override posible. |
| `sobreendeudamientoComputable` | EXC-003 | `(deudas_bureau + cuota_proyectada) / income.salary > 0.5` | Predictor fuerte de default. Solo aplica cuando `income.salary` es autoritativo (IESS); para autonomos sin sueldo verificado no se evalua hard, pasa al confidence con peso menor. |

**No constitucionales (van a soft confidence):**

- Lado senior de EXC-002 (`> 75 anos`): algunas cooperativas tienen producto senior con codeudor. Senal soft con `age_band` weight 0.10.
- SCO-001 (`score < 500`): puede aprobarse con codeudor o producto SCO-002/SCO-003. Senal soft via `bureau_score` mapping.

**Diferencia con el corpus markdown.** Las EXC del corpus son la *politica narrada* que el LLM consulta; las constitucionales son el *subset codificado* que la red de seguridad valida. El corpus puede tener mas EXC en el futuro (ej. lista negra de morosidad SBS) sin que `preDecide()` cambie.

### 3. Fuentes autoritativas — `preDecide()` solo opera sobre datos verificables

Una red de seguridad solo es safety net si sus inputs son safety net. `preDecide` consume **solo** campos que vienen de cruce con sistema externo verificable:

| Campo | Fuente | Autoritativo | Uso en `preDecide` |
|---|---|---|---|
| `identity.valid` | RegistroCivilMock | Si | identityFallecido |
| `identity.birthDate` | RegistroCivilMock | Si | menorDeEdad |
| `income.salary` | IessMock | Si | sobreendeudamientoComputable |
| `bureau.history` | EquifaxMock | Si | sobreendeudamientoComputable (deudas) |
| `state.ingresos` | Form auto-declarado | **NO** | NO usado en preDecide |
| `state.monto`, `state.plazo` | Form auto-declarado | **NO** | NO usado en preDecide |

Datos auto-declarados pueden entrar a `computeConfidence` (signal soft) pero nunca a `preDecide`. Documentar la regla en codigo:

```ts
// preDecide solo consume campos autoritativos. Auto-declared inputs (ingresos,
// monto, plazo) NO entran aqui — pueden estar mal por error u omision del
// solicitante. Si la fuente del dato no es deterministica, la red de seguridad
// tampoco lo es.
```

#### Mocks vs produccion: el contrato no cambia

Las fuentes listadas (`RegistroCivilMock`, `IessMock`, `EquifaxMock`) son los mocks de slice 7. **El contrato de `preDecide` no cambia cuando se reemplazan por integraciones reales** — el agente lee del `state` con el mismo shape, y el state es producido por agentes upstream con la misma signature de schema. Los mocks viven detras de la misma interfaz que las APIs reales (un `Client` con metodos tipados validados con Zod), por construccion.

En produccion real, los mocks se reemplazan por:

| Mock actual | Integracion productiva |
|---|---|
| `RegistroCivilMock` | API del Registro Civil de Ecuador (autenticacion via convenio cooperativa-DINARDAP) |
| `IessMock` | API del IESS (autenticacion via convenio empleador o consulta vertical) |
| `EquifaxMock` | Buro de credito EC (Equifax, Datacredito, BIQ — depende de cooperativa) |

La sustitucion es transparente al `decisionAgent`. El refactor productivo es responsabilidad de un slice futuro de "production-hardening" (despues de slice 13) que cubre auth + rate limits + SLAs reales sin tocar la logica del agente. Esto es lo que hace al sistema slice 7 **listo arquitectonicamente para produccion**, no solo demo: las integraciones se cablean despues, el contrato del agente esta cerrado.

### 4. Audit trail explicito en cada decision

Cada `Decision` (hard o soft) lleva metadata suficiente para que un auditor reconstruya la decision sin correr el sistema. Discriminated union con dos shapes:

```ts
type AuthoritativeSource = 'registro_civil' | 'iess' | 'bureau' | 'derived';
// 'derived' = computado de campos autoritativos (ej. edad de birthDate).
// 'form_input' NO aparece — datos auto-declarados estan vetados de hard rejects
// por construccion (ver seccion 3).

type DecisionOutput =
  | {  // Hard reject — siempre desde preDecide
      decision: 'REJECTED';
      decisionType: 'hard_reject';
      confidence: 1.0;             // hard_rejects son deterministicos —
                                   // no hay incertidumbre estadistica que comunicar
      llmBypassed: true;
      triggeredBy: {
        field: string;             // ej. 'identity.valid', 'identity.birthDate'
        source: AuthoritativeSource;
        value: unknown;            // valor crudo que disparo
        computed?: object;         // ej. { age: 15 } cuando se deriva de birthDate
      };
      citedRules: string[];        // 1 elemento, el EXC que disparo
      reason: string;              // mensaje fijo por regla, NO del LLM
    }
  | {  // LLM decision — desde computeConfidence + LLM
      decision: 'APPROVED' | 'REVIEW';
      decisionType: 'llm_decision';
      confidence: number;          // [0, 1] del computeConfidence (ver sec 5)
      llmBypassed: false;
      breakdown: SignalContribution[];  // output literal de computeConfidence,
                                        // persistido para que el auditor reproduzca
      reason: string;              // del LLM
      citedRules: string[];        // del LLM, validado subset de policy.applies
      modelRequested: string;
      modelActual: string;
      degraded: boolean;
    };

interface SignalContribution {
  signal: string;        // 'bureau_score' | 'alt_score' | ...
  weight: number;        // peso fijo de la formula
  rawValue: number | null;  // valor de entrada (null si senal unavailable)
  contribution: number;  // [0, 1] mapeado por la funcion de la senal
  weighted: number;      // weight * contribution — lo que suma al total
}
```

`triggeredBy` para hard rejects incluye `source` para que el auditor verifique que el dato es autoritativo (ver seccion 3). Si `source === 'form_input'` entrara aqui seria un bug — el codigo de `preDecide` no acepta inputs auto-declarados, lo bloqueamos con tests.

`breakdown` para llm_decision es **literalmente el output de `computeConfidence(state).breakdown`** — el campo persistido en audit es identico al que la funcion produce. Esto conecta seccion 5 (formula) con seccion 4 (audit trail): el auditor toma el breakdown del JSON, suma `weighted` por fila y reproduce `confidence` exacto.

#### Definicion de `degraded: true`

El campo `degraded: true` en el output del decisionAgent (solo aplicable a `llm_decision`) se marca cuando ocurre **cualquiera** de estas tres condiciones:

1. **Fallback de modelo LLM.** El modelo solicitado (`modelRequested`) no esta disponible y el LLM client cae a fallback — Haiku en vez de Sonnet, ej. cuando Sonnet retorna 5xx persistente o se abre el breaker. Detectado por el wrapper LLM (`src/lib/llm/index.ts` ya emite `degraded: true` en `GenerateResult` cuando el fallback dispara — slice 6 lo cableo).
2. **Fallback a `reason` canned por bucket.** El LLM falla post-retry (incluyendo fallback a Haiku) o produce output que no parsea con Zod. El decisionAgent cae a un `reason` plantilla por bucket (ver seccion 8 — los 4 ejemplos sirven como fallback minimo) en lugar de propagar OperationalError. La decision/confidence/breakdown numericos se preservan; solo el texto narrativo es canned.
3. **Propagacion transitiva.** Cualquier agente upstream (intake, identity, income, bureau, alt_score, policy) corrio con `degraded: true`. Por ejemplo, si bureau cayó y el state tiene `bureau: undefined`, el decisionAgent hereda `degraded: true` aunque su LLM call haya sido perfecta. La propagacion vive en `state.__degraded?: { agentName, reason }[]` que cada agente populates si se degrado.

`confidence` numerico **NO se ajusta** cuando `degraded: true` — sigue siendo el computado por la formula determinista. La degradacion afecta solo la calidad narrativa del `reason` y la confiabilidad del fallback de modelo. El oficial humano ve el banner amber + disclaimer y sabe que debe leer con mas atencion.

### 5. Formula del confidence — 6 senales lineales con clamp, ratio 55:25:20 (formal:inclusion:modificadores)

```
confidence = clamp01(sum(weight_i × contribution_i))
```

| Senal | Peso | Mapeo a [0, 1] |
|---|---|---|
| `bureau_score` | **0.25** | linear `[500, 720]` → `[0, 1]`. Default 0.5 si bureau falla operacionalmente. |
| `alt_score` | **0.25** | linear `[30, 80]` → `[0, 1]`. Default 0.5 si sin_data. |
| `iess_affiliation` | **0.15** | afiliado=1.0, autonomo=0.4 (NO 0 — MIC-001/002 los aceptan). |
| `iess_tenure` | **0.15** | linear `[12, 84]` meses → `[0, 1]`. 0 si autonomo. |
| `hard_inquiries` | **0.10** | `count >= 3 → 0.0`, `2 → 0.7`, `1 → 0.85`, `0 → 1.0`. Espejo de MIC-005. |
| `age_band` | **0.10** | linear `[75, 85]` → `[1, 0]`. Penalidad soft de senior, overrideable. |

**Total pesos = 1.00. `amount_to_income` FUERA** — overlap con DTI hard reject + `bureau_score`; al 5% ceremony, al 10% pelea con DTI. Si en slice 8 algun caso necesita capturar "monto absurdo vs ingreso" (piden 50K con ingreso 1K) se agrega como sanity check separado, no como senal de scoring.

**Cálculo explícito del ratio formal:inclusion = 55:25:20:**

| Categoria | Senales | Suma de pesos |
|---|---|---|
| **Formal** (verificacion institucional) | `bureau_score` 0.25 + `iess_affiliation` 0.15 + `iess_tenure` 0.15 | **0.55** |
| **Inclusion** (data alternativa para thin-files) | `alt_score` 0.25 | **0.25** |
| **Modificadores comportamentales** | `hard_inquiries` 0.10 + `age_band` 0.10 | **0.20** |
| Total | | **1.00** |

**Por que NO 65:15 formal:inclusion (propuesta inicial rechazada):** Cooperativas EC bajo SEPS existen para servir lo que bancos privados ignoran — autonomos, asalariados de pymes, comerciantes informales. Si bureau pesa 65%+, el demo se vende solo a cooperativas que ya operan como bancos privados pequenos (las que NO necesitan el producto). El target real son cooperativas que quieren competir por inclusion sin morir de default. Inclusion-first NO significa laxo — los hard rejects (DTI, fallecido, menor) cubren riesgo regulatorio. El confidence puede sesgarse a inclusion sin comprometer prudencia porque la red de seguridad esta en otra capa.

**Caveat del default neutral 0.5 cuando senal unavailable** — deuda documentada slice 9+:

Cuando un upstream agent falla operacionalmente (ej. EquifaxMock cae con error_500 y el breaker se abre), el campo del state queda `undefined`. La formula actual aplica `0.5` como default neutral en esos casos. **Esto puede esconder bias.** Ejemplo: si bureau cae para todos los autonomos (red privada con peor SLA hacia bureaus locales), el confidence promedio sube artificialmente porque autonomos heredan `0.5` en lugar de su distribucion real. Slice 9+ debe refactor a normalizacion sobre senales disponibles (`weighted_sum / sum_of_active_weights`). Disparador de upgrade: ver tabla de section 11.

**Por que pesos lineales y no algo mas sofisticado:**

- **Logistic regression / scoring card calibrada** — seria lo correcto en produccion real con dataset labeled `(state, oficial_decided, default_si_no)`. En demo sintetico no hay ground truth real. Pesos fijos son honestos sobre eso.
- **Tree-based decision (if-else explicito)** — depende del orden de reglas y dificil de explicar como "score". Dificil mostrar al oficial "tu score es 0.62 porque...".
- **El LLM calcula confidence** — vetado por esta misma ADR (regla principal): el LLM no autoasigna confianza.

### 6. Threshold APPROVAL_THRESHOLD = 0.70 — valor inicial del calibration loop, NO destino fijo

```ts
// src/agents/decision/internal/confidence.ts
export const APPROVAL_THRESHOLD = parseFloat(
  process.env.CONFIDENCE_THRESHOLD ?? '0.70',
);
```

**`0.70` es el primer valor del calibration loop (seccion 7), no una constante.** Configurable via env var `CONFIDENCE_THRESHOLD` desde el dia 1. Documentado en `.env.example`. Slice 9 con observability decide el threshold operativo basado en data — pueden ser `0.65`, `0.72` u otro segun lo que muestre el oficial. El codigo nunca debe hardcodear `0.70` como if-else literal — solo referencia la constante.

**Mapeo confidence → decision:**

| `decisionType` | `confidence` | `decision` |
|---|---|---|
| `hard_reject` | 1.0 (siempre) | `REJECTED` |
| `llm_decision` | `>= 0.70` | `APPROVED` |
| `llm_decision` | `< 0.70` | `REVIEW` |

**REJECTED solo viene de hard_reject.** No hay "REJECTED por confidence bajo" desde llm_decision. Razones:

1. Coherente con la tesis inclusion-first: bureau bajo + thin file no rechaza automatico — el oficial humano puede decidir conceder primer credito construccion historial (SCO-003 existe para eso).
2. Coherente con "decision sugerida": el sistema sugiere, el humano decide. REJECTED automatico por confidence estadistico contradice la promesa.
3. Defendible regulatoriamente: cuando un regulador pregunta "por que rechazaron a este senor", la respuesta para hard_reject es "porque cumple EXC-001 (codigo auditable)"; para REVIEW escalado es "no rechazamos, escalamos al oficial". Sin rechazos automaticos no auditables.

**0.70 (no 0.75):** calculo de la mediana del dataset (`bureau 672 → 0.78 × 0.25, alt mediana ~55 → 0.50 × 0.25, ...`) cae en `~0.70`. Con threshold 0.75, la mediana del dataset cae en REVIEW — vacia el demo. 0.70 es la calibracion inicial, recalibra con histograma del eval.

### 7. Calibration loop — disparadores documentados para mover el threshold

| Senal observada | Accion |
|---|---|
| `%REVIEW del dataset > 50%` | Bajar threshold (estamos saturando al oficial). |
| Oficiales aprueban `>80%` de REVIEWs sin condiciones | Bajar threshold (el modelo es mas conservador que el humano). |
| Oficiales rechazan `>80%` de REVIEWs por razones obvias | Mantener o subir threshold (el modelo deja entrar casos que el humano filtra). |

**Windows temporales para cada senal:** ver tabla "Disparadores de upgrade" mas abajo (cada disparador especifica `30 dias` u otro horizonte). Como referencia operacional general: **review rate medido sobre window movil de 30 dias o ultimas 100 decisiones (lo que llegue primero)**. Esto evita que `1 mal dia` mueva el threshold prematuramente y, simetricamente, que un volumen alto en `< 30 dias` retrase un ajuste necesario.

Esto convierte el threshold en palanca operativa, no magic number.

### 8. System prompt del LLM — 4 buckets de tono testeables, modo balanceado, idioma forzado

El LLM produce SOLO `reason` y `citedRules`. NO produce decision ni confidence. El system prompt:

- Pasa al LLM: perfil completo + `policy.applies` + `fullText` de las reglas + confidence calculado + decision tentativa + threshold actual.
- Mitiga anchoring: "Evalua el caso como si no supieras la decision tentativa. Tu output puede contradecir el numerico si tu razonamiento lo amerita — eso es feature, no bug."
- 4 buckets de tono testeables, **con ejemplos del shape esperado del `reason`** que sirven como fixtures de eval:

**Bucket A — `APPROVED` con `confidence >= 0.85`** (favorable directo, 1-2 fortalezas dominantes, sin caveats forzados):

> "Perfil solido: afiliacion IESS de 84 meses con sueldo 1450, score Equifax 720 y huella digital saludable. Aprobacion con condiciones estandar de MIC-003."

**Bucket B — `APPROVED` con `confidence 0.70-0.85`** (favorable balanceado, fortalezas + 1 punto de monitoreo concreto):

> "Aprobamos basados en estabilidad laboral (96 meses Holcim, sueldo 1340) y score crediticio bueno (710). Punto de monitoreo: las 2 hard inquiries recientes sugieren busqueda activa de credito — verificar que el solicitante no tenga otras solicitudes paralelas."

**Bucket C — `REVIEW` con `confidence 0.40-0.70`** (cauteloso, tension especifica, que verificar):

> "Solicitud requiere revision. Tension principal: solicitante autonomo sin RUC activo, lo cual limita producto a MIC-001 (tope 2,500); sin embargo, el alt-score 64 con senales de regular_income es defendible. Verificar que el monto solicitado (3,000) calce dentro del tope de su producto."

**Bucket D — `REVIEW` con `confidence < 0.40`** (critico pero constructivo, que faltaria para subir):

> "Perfil con senales debiles: bureau 480, sin afiliacion IESS, alt-score 32 con high_volatility. Para considerar aprobacion: solicitante deberia presentar codeudor con score >= 700 (espejo GAR-001) o esperar 6 meses para que el alt-score muestre estabilidad."

Estos ejemplos son fixtures testeables: el eval del LLM verifica que el `reason` producido en cada bucket cumple shape (longitud, tono, presencia/ausencia de caveats). Si el LLM driftea, el eval falla.

- Idioma forzado: "Responde SIEMPRE en espanol, lenguaje de oficial de credito ecuatoriano. Prohibido ingles excepto para terminos tecnicos estandar (DTI, alt-score, IESS, RUC)".
- `temperature: 0.3` — analisis estructurado, no creativo.
- `citedRules` validado `⊆ policy.applies` (DomainError si cita regla desconocida). NO se requiere `>= 1` — caso legitimo que un caso solido sea narrativo general sin citar regla especifica.

#### `max_tokens` vs `reason ≤ 500 chars` — son cosas distintas

Dos defensas en capas, no equivalentes:

1. **`max_tokens: 200` en el LLM call** (`messages.create`). 1 token ≈ 4 chars en español → 500 chars son ~125 tokens. Setear `max_tokens = 200` da margen de seguridad sobre los 125 necesarios sin permitir desbordes patologicos. Si el LLM intenta producir mas, Anthropic API lo trunca. Defensa preventiva.

2. **Validacion Zod post-parsing**: `reason: z.string().max(500)`. Si por alguna razon el LLM produce `>500` chars (raro pero posible — algunos tokens son largos en español, ej. "construccion historial"), el agente falla con `DomainError("reason exceeds max length")`. Defensa correctiva.

3. **Fallback a `reason` canned por bucket** cuando alguna defensa falla. Si `max_tokens` truncó el output o Zod rechaza el reason, el decisionAgent NO propaga `OperationalError` al orchestrator (eso aborta la pipeline). En su lugar, sustituye `reason` por una plantilla canned correspondiente al bucket (basadas en los 4 ejemplos de arriba) y marca `degraded: true`. La decision/confidence/breakdown se preservan. El oficial ve disclaimer en banner y panel.

```ts
// Pseudo-codigo del fallback en decisionAgent.execute
try {
  const llmResult = await llm.generate({ ..., maxTokens: 200 });
  const parsed = JSON.parse(cleanJsonFences(llmResult.text));
  const validated = llmOutputSchema.parse(parsed);  // z.string().max(500) sobre reason
  return { ..., reason: validated.reason, citedRules: validated.citedRules, degraded: llmResult.degraded };
} catch (err) {
  if (err instanceof z.ZodError || err instanceof SyntaxError) {
    // LLM produced invalid output — fall back to canned reason for the bucket
    return { ..., reason: cannedReasonForBucket(decision, value), citedRules: [], degraded: true };
  }
  throw err;  // OperationalError propagates to orchestrator (saga path)
}
```

### 9. Token usage — counting con persistencia, sin enforcement (slice 9 cierra)

Slice 7 introduce dos LLM calls por solicitud (policy + decision). Counting + persistencia para tener data historica que permita recalibrar threshold operativo en slice 9. **NO enforcement** todavia.

- Tabla nueva `application_token_usage(id, application_id fk, agent_name, input_tokens, output_tokens, created_at)`.
- `ExecCtx` extendido con `onLlmCall?: (agentName, usage) => void`. Orchestrator pasa un recorder que recolecta y persiste batch al final del run.
- Span attributes granulares: `tokens.policy.input/output`, `tokens.decision.input/output`, `tokens.total`.
- **NO** se referencia a `50K` ni se logea contra threshold — normalizar el numero antes de tener data lo invalida. Slice 9 con Langfuse decide threshold operativo real.

### 10. UI — banner arriba + panel v6 abajo + degraded visible obligatorio

Patron editorial-meta dual:

- **Banner cabecera** (color por estado, eyebrow + h2 serif + reason corto + chips citedRules + label de accion).
- **Panel v6** detallado con audit trail: triggeredBy para hard_reject, breakdown legible (columna "Aporta %" en lugar de calculo crudo) para llm_decision, telemetria colapsable.

**3 labels distintos por accion del oficial:**

| Estado | Label | Accion del oficial |
|---|---|---|
| `APPROVED` | (sin label) o "LISTO PARA APROBAR" | Aprobar con un click |
| `REVIEW` | "ESCALADA A HUMANO" | Decidir con contexto |
| `REJECTED` (hard) | "RECHAZO AUTOMATICO" o "NOTIFICAR AL CLIENTE" | Comunicar resultado al cliente |

NO usar "ESCALADA" para hard reject — el sistema decidio automaticamente, el oficial solo notifica. "Escalada" implica reversibilidad que contradice el modelo de hard reject.

**Visibilidad obligatoria de `degraded: true`:**

- Banner lleva label adicional "MODO DEGRADADO" en color amber (incluso si APPROVED).
- Panel v6 muestra disclaimer al inicio: "Esta decision se calculo en modo degradado. Razon: `{modelRequested → modelActual}`".
- Telemetria colapsable mantiene los detalles tecnicos (modelo, tokens).

NO es opcional. Si en demo aparece degraded sin que el oficial lo vea, perdemos credibilidad cuando alguien pregunte "y si el LLM falla, como se refleja?".

**Lead copy (header):**

- `APPROVED`: "Solicitud lista para aprobacion con las condiciones citadas."
- `REVIEW`: "Solicitud requiere revision humana. Lee el razonamiento abajo." (generico — sin claim cuantitativo "N puntos de tension" porque el LLM no enumera tension points en slice 7. Si en eval suena debil, slice 8 agrega `tensionPoints: number` al schema del LLM output.)
- `REJECTED hard`: "Solicitud rechazada por regla constitucional ({rule_id}). Auditoria disponible abajo."
- Mantener fallbacks existentes cuando pipeline incompleto.

**Click en chip `citedRule`:** anchor a `id="policy-rule-{ruleId}"` en el panel v5 con el `<details>` del `fullText`. NO modal nuevo — reusamos mecanismo de slice 6.

## Disparadores de upgrade futuro

Esta tabla es la razon principal del ADR. El proximo que toque decisionAgent sabe en que orden escalar sin reabrir esta conversacion.

**Cada fila tiene 3 columnas** — estado actual del codigo, senal **especifica y medible** que dispara el upgrade, y forma concreta del upgrade. Sin senales numericas claras los disparadores nunca disparan porque "muchos" es subjetivo.

| Estado actual | Senal que dispara upgrade | Forma del upgrade |
|---|---|---|
| `APPROVAL_THRESHOLD = 0.70` (env var) | (a) `> 50%` del dataset cae en REVIEW; (b) oficiales aprueban `> 80%` de REVIEWs sin condiciones extra durante 30 dias post-deploy; (c) oficiales rechazan `> 80%` de REVIEWs por razones obvias durante 30 dias | Bajar a `0.65` (caso a o b) o subir a `0.75` (caso c). Documentar el dato que justifica el cambio en el ADR sucesor. |
| Pesos lineales fijos `(0.25, 0.25, 0.15, 0.15, 0.10, 0.10)` | Existencia de dataset labeled `>= 500` decisiones reales con outcome `(approved_decision_correct si/no, default_si_no)` | Entrenar logistic regression sobre el dataset. Reemplazar funciones de contribucion lineales con coeficientes calibrados. Mantener la interfaz `computeConfidence(state) → { value, breakdown }` para no romper callers. |
| Default neutral `0.5` cuando senal unavailable | En produccion real: aparicion de `>= 5%` de solicitudes con `bureau` o `alt_score` faltante donde la decision producida diverge `>= 1` bucket de la decision del oficial humano | Refactor a normalizacion sobre senales disponibles: `confidence = sum(weight_i × contrib_i) / sum(weight_i)` solo sobre senales `i` con `rawValue !== null`. |
| Sin combinaciones toxicas explicitas | En el eval pre-cableado del dataset (slice 7 step 4): `> 5%` de casos `APPROVED` tienen `>= 2` senales con `contribution < 0.3` | Agregar regla post-confidence en `decisionAgent.execute`: si `tail_low_count >= 2` Y decision es APPROVED, forzar a REVIEW con razon `tail_low_combination`. |
| `amount_to_income` fuera del scoring | Aparicion en demo o pitch de caso "ingreso 1K, piden 50K" donde el sistema actual no captura sanidad obvia | Agregar como sanity check separado en `preDecide` (NO en confidence formula): si `monto > N × ingresos` con `N = 20` configurable, hard reject con razon `unreasonable_amount_to_income`. |
| Modo "balanceado" del LLM (4 buckets, modo unico) | Cooperativa especifica pide razonamientos uniformes "este caso aprueba porque [3 razones positivas]" sin caveats | Config flag `reasoningMode: 'balanced' \| 'uniform'` en env. Sistema selecciona prompt segun config. Slice 11+. |
| LLM puede contradecir confidence | En eval pre-cableado o post-deploy: `> 20%` de los `reason` producidos no agregan informacion sobre el `confidence` numerico (medible: ratio de keywords del reason que ya estan en breakdown) | Switch a opcion II del anchoring: NO pasar `decision` tentativa al LLM, solo `confidence + threshold + breakdown`. El LLM infiere el verdict y el tono. |
| `citedRules` opcional sin minimo | En eval o post-deploy: en `decision === REVIEW`, `< 50%` de los casos el LLM cita al menos una regla | Forzar `citedRules.length >= 1` cuando `decision === 'REVIEW'`. Validation en Zod. |
| Token budget counting solo, sin enforcement | Slice 9 entra: aparicion de Langfuse + dataset de `>= 100` solicitudes con tokens persistidos en `application_token_usage` | Calcular percentil 99 de tokens consumidos. Setear `TOKEN_BUDGET_PER_APPLICATION = p99 × 1.5` (margen). Implementar enforcement con saga `token_budget_exceeded` que aborta pipeline y marca REVIEW. |
| Sin priorizacion de cola REVIEW | Demo a cooperativa que procese `> 30` solicitudes diarias en una sola pantalla | Agregar campo derivado `review_priority: 'high' \| 'medium' \| 'low'`: confidence 0.6-0.7 → high, 0.4-0.6 → medium, < 0.4 → low. No cambia decision, solo orden visual de la cola. |
| Lead copy generico para REVIEW ("Lee el razonamiento abajo") | En demo: el lead suena debil al menos `2` veces en pitches consecutivos donde el oficial pregunta "y por que?" antes de leer el reason | Slice 8 agrega `tensionPoints: { count: number, summary: string[] }` al schema del LLM output. Lead lo usa: "Solicitud requiere revision humana — el sistema escala N puntos de tension". |

## Consequences

### Positivas

- **Pieza pivotal del demo cerrada.** El sistema produce output canonico (APPROVED/REJECTED/REVIEW) auditable end-to-end.
- **Defendible ante regulador.** Hard rejects son codigo trazable. Confidence es funcion deterministica explicable. LLM solo aporta narrativa.
- **Tesis inclusion-first realizable.** Pesos `0.55` formal vs `0.25` inclusion (alt_score equiparado a bureau peso a peso, 0.25 cada uno) permiten aprobar thin-files con compensadores. Bureau no es oraculo.
- **Calibration loop documentado.** Threshold no es magic number — es palanca operativa con disparadores claros.
- **UI honesta.** Degraded visible, audit trail claro, 3 labels diferentes por accion del oficial.
- **Costo bajo del LLM.** Hard rejects no consumen tokens. Decision normal: ~3K tokens / $0.005 USD por solicitud.

### Negativas

- **Duplicacion de logica EXC entre corpus y codigo.** Mitigacion: comentario `// espejo de EXC-XXX — actualizar ambos juntos` en cada constante. Para slice 7 la deuda es aceptable; si un cliente real necesita DSL de politica, slice 12+.
- **Pesos no calibrados con datos reales.** No hay ground truth en demo sintetico. El ADR documenta el disparador para entrenar logistic regression en cuanto haya `>500` casos labeled.
- **Default neutral 0.5 puede esconder bias.** Si bureau cae para todos los autonomos, el confidence promedio sube artificialmente. Slice 9+ refactor a normalizacion sobre senales disponibles.
- **Sin combinaciones toxicas.** Pesos lineales no capturan "bureau bajo Y autonomo Y alt borderline = peor que la suma". Eval pre-cableado mide si el problema aparece; si si, post-confidence rule.
- **LLM puede contradecir confidence.** El modo balanceado lo permite intencionalmente como feature, pero requiere monitoreo en eval para detectar rationalizacion ciega `>20%`.

## Alternatives considered

**1. Hard rejects via LLM** (`policy.applies` incluye EXC → REJECTED automatico).
Rechazado: regulatoriamente indefendible. Una cooperativa supervisada por SBS no puede defender "el modelo se acordo de citar EXC-001 cuando habia fallecido" como garantia de seguridad. Si en 1 de cada 1000 casos el LLM omite la cita, el sistema aprueba a un muerto. La justificacion debe vivir en codigo trazable que un auditor pueda reproducir sin ejecutar el modelo.

**2. REJECTED por confidence bajo (Modelo B con threshold 0.30)**.
Rechazado: introduce un REJECTED estadistico no defendible. ¿Por que 0.30 y no 0.25? Sin ground truth real, cualquier numero es arbitrario. Tambien contradice la promesa fundamental de "decision sugerida" — el sistema sugiere, el humano decide. Rechazo automatico por estimacion estadistica del LLM-confidence elimina el escape valve humano.

**3. Solo APPROVED y REJECTED sin REVIEW (Modelo C)**.
Rechazado: elimina el escape valve a humano que es el corazon del producto. Una cooperativa que confia en el sistema sin escalacion clara cae en el patron Bhaumik (20% de aprobaciones mal). REVIEW no es debilidad, es el ancla que mantiene al humano engaged en el loop.

**4. `amount_to_income` como senal del scoring lineal**.
Rechazado: overlap con DTI hard reject + `bureau_score` (que ya captura ratio implicitamente). Al peso 5% es ceremony sin mover la aguja; al peso 10% pelea con DTI y duplica logica. Si necesita capturar "monto absurdo vs ingreso" (ej. piden 50K con ingreso 1K), va como sanity check separado en `preDecide` con threshold configurable, NO como signal lineal de scoring (ver tabla disparadores).

**5. Pesos `65/15` formal:inclusion** (propuesta inicial pre-grilling).
Rechazado: contradice positioning inclusion-first del producto. Cooperativas EC bajo SEPS existen para servir lo que bancos privados ignoran — autonomos, asalariados de pymes, comerciantes informales. Si bureau pesa 65%+, el demo se vende solo a cooperativas que ya operan como bancos privados pequenos (que no necesitan el producto). Target real: cooperativas que quieren competir por inclusion sin morir de default. Pesos `55/25/20` reflejan eso.

**6. Token budget enforcement en slice 7**.
Rechazado: `50K` es magic number heredado de CONTEXT.md sin calibracion. Sin data real de tokens consumidos por solicitud (solo dispone slice 7 — primer agente que llama LLM), cualquier enforcement es a ciegas. Implementar saga `token_budget_exceeded` con threshold no calibrado introduce false positives o no dispara nunca. Slice 9 con Langfuse + persistencia de `application_token_usage` decide threshold operativo (probable p99 × 1.5) y cierra saga.

**7. A+ visual** (mostrar "3.2K/50K usados" en UI sin enforcement subyacente).
Rechazado: teatro de seguridad. Promete control que no existe. Cuando un prospect pregunta "¿que pasa si el LLM responde 50K tokens por bug?" y la respuesta es "nada hoy, viene en slice 9", el visual queda sin respaldo y erosiona credibilidad mas que la falta del visual. Regla: o tenes enforcement con visual, o no tenes visual. Slice 9 hace ambos juntos.

**8. Tool use de Anthropic para output structured** (en lugar de JSON parsing + Zod).
Rechazado para slice 7: garantizaria shape valido sin Zod parsing manual, pero requiere registrar tools en el LLM client (`src/lib/llm/index.ts` hoy solo soporta text generation — habria que extenderlo). Slice 6 ya uso JSON+Zod, mantener consistencia. Reconsiderar cuando `>= 2` agentes necesiten output structured y el costo de mantener 2 paths sea `>` el costo de migrar a tools (probable slice 11+ con `decisionAgent` v2 + slice futuro de eval-judge agent).

**9. NO pasar decision tentativa al LLM (opcion II del anchoring)**.
Aplazado, no rechazado. Empezamos con opcion I (pasar decision tentativa) + mitigacion en system prompt ("Evalua como si no supieras la decision"). Razon: la coherencia operativa entre numerico y narrativa vale mas que la pureza anti-anchoring. Switch a II si eval muestra rationalizacion ciega `>20%` (medible: ratio de keywords del reason que ya estan en breakdown). Disparador documentado en tabla de upgrades.

**10. `tensionPoints: number` estructurado en LLM output** (para que lead copy pueda decir "N puntos de tension").
Aplazado: slice 8+ si lead generico de REVIEW ("Lee el razonamiento abajo") suena debil en demo real. Razon para no implementarlo upfront: agrega un campo mas al schema del LLM output que hay que validar y testear, sin saber aun si el lead generico es suficiente. Disparador: `>=2` pitches consecutivos donde oficial pregunta "¿por que?" antes de leer el reason.

## Coherencia interna entre secciones

Las decisiones del ADR se conectan; el lector de slice 12 debe poder rastrear los hilos:

- **Seccion 4 (audit trail) ↔ Seccion 5 (formula):** el `breakdown` que persiste en el output del decisionAgent (`SignalContribution[]`) es **literalmente el output de `computeConfidence(state).breakdown`** — sin re-mapeo. Un auditor toma la fila JSON, suma `weighted` por fila, y reproduce `confidence` exacto. Esto es lo que hace el sistema auditable.
- **Seccion 6 (threshold) ↔ Seccion 7 (calibration):** `0.70` es el primer valor del calibration loop, no una constante. El env var `CONFIDENCE_THRESHOLD` existe desde el dia 1 precisamente porque el numero es movible. El loop documenta los disparadores que justifican moverlo.
- **Seccion 9 (token usage) ↔ CONTEXT.md:** el termino `Token budget` en CONTEXT.md describe enforcement futuro. Slice 7 implementa solo el counting (tabla `application_token_usage` + `onLlmCall` callback). Slice 9 con Langfuse cierra enforcement con threshold operativo calibrado de la data persistida. Update a CONTEXT.md tras este ADR: agregar nota "tracked desde slice 7, enforcement pendiente slice 9 — ver ADR-0008".
- **Seccion 2 (constitucional) ↔ Seccion 3 (autoritativo):** las dos son condiciones AND para que algo entre a `preDecide`. Una regla puede ser constitucional (no overrideable) pero si su input no es autoritativo, no entra. Por eso DTI es hard reject solo cuando `income.salary` viene del IESS (autoritativo); para autonomos sin IESS, el calculo de DTI usa `state.ingresos` auto-declarado, no autoritativo, y la regla degrada a soft signal.

## Notes

- `src/agents/decision/` es nuevo. La firma de `preDecide()` y sus tests unitarios se validan **antes** de cablear el LLM real (gate de step 2 → 3). El system prompt del decisionAgent se valida **antes** de los E2E (gate de step 5 → 6).
- El eval pre-cableado del dataset (45 personas) es prerequisito de la decision sobre el threshold inicial — corremos histograma + verificar perfiles canonicos (Maria > 0.75, Bryan en 0.4-0.6, fallecido N/A, menor N/A) + tail-low check (>5% trigger regla post-confidence) antes de gastar un solo token del LLM.
- Tabla `application_token_usage` se popula desde slice 7: tanto desde `policyAgent` (slice 6 — agregamos `onLlmCall` retroactivamente) como desde `decisionAgent` nuevo.
- Update CONTEXT.md inline despues de este ADR: ratificar terminos `Decision type`, `Hard reject`, `Reglas constitucionales`, `Audit trail`, `Fuente autoritativa` (todos ya escritos en sesion de grilling); agregar nota a `Token budget` indicando estado actual (counting only, enforcement slice 9).
