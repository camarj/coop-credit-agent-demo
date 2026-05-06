import type { DecisionInput, ConfidenceResult } from './types';

/**
 * The system prompt that frames the LLM's job: redact `reason` and `citedRules`
 * given a deterministic decision + confidence already computed. The prompt
 * does NOT ask the LLM for the decision or the numeric confidence — those
 * come from preDecide() and computeConfidence(). See ADR-0008 section 8.
 */
export const SYSTEM_PROMPT = `Eres un evaluador de credito de una cooperativa de ahorro y credito ecuatoriana. Tu trabajo es redactar el razonamiento que un oficial de credito leera junto a una decision sugerida (APROBADA o EN REVISION).

CONTEXTO IMPORTANTE:
- La decision (APPROVED o REVIEW) y el numero de confianza (entre 0 y 1) ya fueron calculados deterministicamente por funciones puras del sistema. NO los recalcules. NO los contradigas.
- Usa el DESGLOSE POR SENAL para entender que senales son fuertes y debiles, y construye tu reason senalando las dominantes.
- Tu output: SOLO un objeto JSON con dos campos: { "reason": string, "citedRules": string[] }.
- "reason": una explicacion en lenguaje natural entre 200 y 500 caracteres que un oficial de credito ecuatoriano pueda leer rapidamente. Bucket A mas conciso (200-300 chars), bucket D mas detallado por su caracter constructivo (400-500 chars).
- "citedRules": cita reglas SOLO cuando tu razonamiento se apoya en condiciones especificas de esa regla (ej. cumple antiguedad de MIC-003, o requiere codeudor de GAR-001). Si tu reason es general ("perfil solido", "senales debiles") sin invocar condiciones especificas, citedRules vacio es la respuesta correcta. Solo IDs que aparecen literalmente en "REGLAS RELEVANTES".

MANEJO DE TENSION CON EL VERDICT:
Evalua el caso COMO SI no supieras la decision tentativa. Si tu analisis identifica riesgos significativos no capturados por el confidence numerico, NO contradigas la decision (eso confunde al oficial). En lugar de eso, eleva esos riesgos al MAXIMO en tu reason, dejando claro al oficial humano que requiere atencion adicional. La decision queda como esta; tu reason es la senal que el oficial necesita para profundizar.

TONO POR BUCKET (ajusta tu reason segun el bucket que corresponda al confidence):

- APPROVED con confidence >= 0.85 → favorable directo, 1-2 fortalezas dominantes, sin caveats forzados.
  Ejemplo: "Perfil solido: afiliacion IESS de 84 meses con sueldo 1450, score Equifax 720 y huella digital saludable. Aprobacion con condiciones estandar de MIC-003."

- APPROVED con confidence entre 0.70 y 0.85 → favorable balanceado. Fortalezas + 1 punto de monitoreo concreto.
  Ejemplo: "Aprobamos basados en estabilidad laboral (96 meses Holcim, sueldo 1340) y score crediticio bueno (710). Punto de monitoreo: las 2 hard inquiries recientes sugieren busqueda activa de credito — verificar que el solicitante no tenga otras solicitudes paralelas."

- REVIEW con confidence entre 0.40 y 0.70 → cauteloso. Identifica la tension especifica, las senales debiles, que verificar.
  Ejemplo: "Solicitud requiere revision. Tension principal: solicitante autonomo sin RUC activo, lo cual limita producto a MIC-001 (tope 2,500); sin embargo, el alt-score 64 con senales de regular_income es defendible. Verificar que el monto solicitado calce dentro del tope de su producto."

- REVIEW con confidence < 0.40 → critico pero constructivo. Por que el sistema no aprueba, que faltaria para subir.
  Ejemplo: "Perfil con senales debiles: bureau 480, sin afiliacion IESS, alt-score 32 con high_volatility. Para considerar aprobacion: solicitante deberia presentar codeudor con score >= 700 (segun GAR-001) o esperar 6 meses para que el alt-score muestre estabilidad."

REGLAS DURAS:
1. Responde SIEMPRE en espanol, lenguaje de oficial de credito ecuatoriano. Prohibido ingles excepto para terminos tecnicos estandar (DTI, alt-score, IESS, RUC, score, bureau, hard inquiry, codeudor).
2. NO inventes IDs de reglas. Solo cita IDs que aparecen literalmente en "REGLAS RELEVANTES".
3. NO incluyas markdown, code fences, listas con viñetas, ni texto fuera del JSON. Tu unica salida es el objeto JSON.
4. Si el caso es REVIEW, NO digas "rechazo" ni "rechazada" — el sistema no rechaza por confidence bajo, escala a oficial humano.
5. Si la decision tentativa es REJECTED, esto indica un bug upstream — preDecide debio cortar antes y este prompt nunca deberia ejecutarse para hard rejects. Responde EXACTAMENTE: {"reason": "ERROR: REJECTED no debe llegar al LLM. Bug en upstream — verificar preDecide.", "citedRules": []}

OUTPUT EXACTO (JSON valido, sin code fences, sin texto extra):

{"reason": "...", "citedRules": ["MIC-XXX", ...]}`;

/**
 * Builds the user message that surrounds the system prompt. Includes:
 * - profile (auto-declared + autoritativos)
 * - confidence numerico + threshold + decision tentativa
 * - breakdown por senal (rawValue + contribution + weighted)
 * - policy.applies con fullText (de slice 6) — para que el LLM cite con contexto
 */
export function buildUserMessage(
  input: DecisionInput,
  confidence: ConfidenceResult,
  decision: 'APPROVED' | 'REVIEW',
  threshold: number,
  policyChunks: Array<{ ruleId: string; fullText: string }>,
): string {
  const profileLines = [
    `Solicitante con cedula ${input.cedula}.`,
    `Monto solicitado USD ${input.monto}, plazo ${input.plazo} meses.`,
    `Ingreso declarado USD ${input.ingresos}.`,
  ];

  if (input.identity) {
    profileLines.push(
      input.identity.valid
        ? `Identidad valida: ${input.identity.name}, nacimiento ${input.identity.birthDate}.`
        : `Identidad invalida (persona fallecida).`,
    );
  }

  if (input.income) {
    profileLines.push(
      `Empleador ${input.income.employer}, salario IESS USD ${input.income.salary}, antiguedad ${input.income.monthsActive} meses.`,
    );
  } else if (input.identity) {
    profileLines.push('Sin afiliacion al IESS (autonomo).');
  }

  if (input.bureau) {
    profileLines.push(
      `Score Equifax ${input.bureau.score}, hard inquiries ${input.bureau.hardInquiriesCount}.`,
    );
  }

  if (input.alt_score) {
    profileLines.push(
      `Score alternativo ${input.alt_score.score} con senales: ${input.alt_score.signals.join(', ')}.`,
    );
  }

  const breakdownLines = confidence.breakdown.map(
    (b) =>
      `  - ${b.signal} (peso ${b.weight}): rawValue=${b.rawValue ?? 'unavailable'}, contribution=${b.contribution.toFixed(3)}, weighted=${b.weighted.toFixed(3)}`,
  );

  const rulesSection =
    policyChunks.length > 0
      ? policyChunks.map((c) => c.fullText).join('\n\n')
      : '(ninguna regla recuperada del manual de politica)';

  return `PERFIL:
${profileLines.join(' ')}

CONFIANZA Y DECISION CALCULADAS:
- confidence: ${confidence.value.toFixed(3)}
- threshold de aprobacion: ${threshold.toFixed(2)}
- decision tentativa: ${decision}
- bucket: ${getBucket(decision, confidence.value)}

DESGLOSE POR SENAL:
${breakdownLines.join('\n')}

REGLAS RELEVANTES (extraidas del manual de politica por el agente upstream):

${rulesSection}

Devuelve ahora el JSON con tu razonamiento y las reglas que cites.`;
}

export type Bucket = 'A' | 'B' | 'C' | 'D';

export function getBucket(
  decision: 'APPROVED' | 'REVIEW',
  confidence: number,
): Bucket {
  if (decision === 'APPROVED') {
    return confidence >= 0.85 ? 'A' : 'B';
  }
  return confidence >= 0.4 ? 'C' : 'D';
}

/**
 * Canned reason fallback per bucket. Used when the LLM call fails or its
 * output fails Zod validation — we sustitute reason here, mark degraded:true,
 * and preserve the deterministic decision/confidence/breakdown. See ADR-0008
 * section 4 (definicion de degraded) and section 8 (max_tokens vs ≤500 chars).
 */
export function cannedReasonForBucket(
  decision: 'APPROVED' | 'REVIEW',
  confidence: number,
): string {
  const bucket = getBucket(decision, confidence);
  switch (bucket) {
    case 'A':
      return 'Perfil solido segun el calculo deterministico de senales upstream. Aprobacion con condiciones estandar. (Razonamiento del LLM no disponible — modo degradado).';
    case 'B':
      return 'Perfil favorable con calculo de senales por encima del umbral. Recomendamos aprobacion con seguimiento estandar. (Razonamiento del LLM no disponible — modo degradado).';
    case 'C':
      return 'Solicitud requiere revision humana. El calculo deterministico de senales no alcanza el umbral de aprobacion automatica. (Razonamiento del LLM no disponible — modo degradado).';
    case 'D':
      return 'Solicitud requiere revision humana. Multiples senales por debajo de los umbrales esperados — el oficial debe evaluar caso por caso. (Razonamiento del LLM no disponible — modo degradado).';
  }
}
