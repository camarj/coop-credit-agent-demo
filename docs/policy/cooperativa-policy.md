# Politica de credito — Cooperativa Mock (v2026-Q2)

> Manual sintetico de microcredito para uso del demo `coop-credit-agent`. Escrito como una cooperativa real escribiria su politica interna. Cada bloque entre `---` es una **regla** autocontenida con ID estable y se chunkea como unidad indivisible para el RAG.
>
> El agente `policyAgent` consulta este corpus via retrieval semantico (top-5) y le pide al LLM que decida cuales aplican al perfil del solicitante.

---

## Regla MIC-001 — Tope para autonomos sin RUC

**Aplica si:** solicitante sin afiliacion vigente al IESS y sin RUC activo.
**Accion:** monto maximo USD 2,500. Plazo maximo 36 meses. Tasa diferencial autonomos.
**Justificacion:** menor capacidad de pago verificable; sin trazabilidad fiscal mitigamos exposicion limitando el ticket.
**Tags:** autonomo, sin-iess, sin-ruc, monto-bajo, microcredito

---

## Regla MIC-002 — Tope para autonomos con RUC y score crediticio bueno

**Aplica si:** solicitante sin afiliacion IESS, con RUC activo, y score Equifax mayor o igual a 650.
**Accion:** monto maximo USD 4,000. Plazo maximo 36 meses. Tasa diferencial autonomos formales.
**Justificacion:** RUC activo y score crediticio bueno compensan ausencia de IESS; el solicitante demuestra trazabilidad fiscal y comportamiento crediticio confiable.
**Tags:** autonomo, sin-iess, con-ruc, score-bueno, microcredito

---

## Regla MIC-003 — Microcredito estandar para afiliados al IESS

**Aplica si:** solicitante con afiliacion vigente al IESS, antiguedad laboral mayor o igual a 12 meses, y sueldo declarado mayor o igual a USD 600.
**Accion:** monto maximo USD 6,000. Plazo maximo 48 meses. Tasa estandar.
**Justificacion:** afiliacion IESS verificada y antiguedad laboral suficiente reducen riesgo de default; ingreso demostrado permite ratios de pago saludables.
**Tags:** afiliado-iess, antiguedad-suficiente, ingreso-demostrado, microcredito-estandar

---

## Regla MIC-004 — Microcredito ampliado para afiliados con score alto

**Aplica si:** solicitante con afiliacion IESS vigente, antiguedad laboral mayor o igual a 24 meses, y score Equifax mayor o igual a 720.
**Accion:** monto maximo USD 12,000. Plazo maximo 60 meses. Tasa preferencial.
**Justificacion:** perfil de bajo riesgo combina estabilidad laboral solida con historial crediticio saludable; permite ticket alto y plazo extendido.
**Tags:** afiliado-iess, antiguedad-alta, score-alto, monto-alto, tasa-preferencial

---

## Regla GAR-001 — Garante personal obligatorio sobre umbral

**Aplica si:** monto solicitado mayor a USD 5,000.
**Accion:** requiere garante personal con score Equifax mayor o igual a 700, antiguedad laboral igual o mayor a 24 meses, y carta de aval firmada.
**Justificacion:** ticket alto exige cobertura adicional de riesgo; el garante actua como respaldo en caso de default.
**Tags:** garantia, monto-alto, garante-personal, requisito-adicional

---

## Regla GAR-002 — Garantia hipotecaria para tickets sobre USD 10,000

**Aplica si:** monto solicitado mayor a USD 10,000.
**Accion:** requiere garantia hipotecaria sobre bien inmueble con avaluo igual o mayor al 130 por ciento del monto solicitado.
**Justificacion:** sobre cierto umbral el garante personal no alcanza; la cobertura real reduce la probabilidad de perdida total.
**Tags:** garantia, monto-muy-alto, hipoteca, ticket-grande

---

## Regla EXC-001 — Exclusion automatica por persona fallecida

**Aplica si:** Registro Civil reporta fecha de fallecimiento para la cedula del solicitante.
**Accion:** rechazo automatico. No procesar etapas posteriores. Notificar caso al equipo de prevencion de fraude.
**Justificacion:** una solicitud a nombre de persona fallecida es indicio claro de suplantacion de identidad; es obligatorio reportar al SBS.
**Tags:** exclusion, fallecido, fraude, prevencion, rechazo-automatico

---

## Regla EXC-002 — Exclusion por edad fuera de rango

**Aplica si:** edad del solicitante menor a 18 anios o mayor a 75 anios al momento de la solicitud.
**Accion:** rechazo automatico. Sugerir alternativas: cuenta de ahorro juvenil para menores, credito asistido para adultos mayores con cotitular.
**Justificacion:** menores de edad no tienen capacidad legal; mayores de 75 implican riesgo actuarial superior al apetito de la cooperativa para microcredito sin seguro.
**Tags:** exclusion, edad, menor-de-edad, adulto-mayor, capacidad-legal

---

## Regla EXC-003 — Exclusion por sobreendeudamiento detectado

**Aplica si:** la suma de cuotas mensuales reportadas en bureau mas la cuota proyectada del nuevo credito excede el 50 por ciento del ingreso mensual demostrado.
**Accion:** rechazo automatico. Sugerir refinanciamiento de deudas vigentes antes de nuevo credito.
**Justificacion:** ratio cuota-ingreso por encima del 50 por ciento es predictor fuerte de default segun analisis historico de la cooperativa; protegemos al solicitante de espiral de deuda.
**Tags:** exclusion, sobreendeudamiento, ratio-cuota-ingreso, dti, prudencial

---

## Regla SCO-001 — Score minimo absoluto

**Aplica si:** score Equifax menor a 500.
**Accion:** rechazo automatico salvo aval de comite especial con justificacion documentada.
**Justificacion:** score por debajo del piso indica historial crediticio severamente comprometido; el riesgo no es absorbible con el spread de microcredito estandar.
**Tags:** exclusion, score-muy-bajo, piso-score, comite-especial, rechazo

---

## Regla SCO-002 — Score complementario alto compensa Equifax bajo

**Aplica si:** score Equifax entre 500 y 599, score alternativo mayor o igual a 70, y solicitante afiliado al IESS con antiguedad mayor o igual a 18 meses.
**Accion:** aprobar con monto reducido (USD 1,500 maximo) y plazo corto (24 meses maximo) para construir historial.
**Justificacion:** combinacion de score alternativo alto y estabilidad laboral verificada sugiere comportamiento de pago saludable que el bureau tradicional no captura. Producto de construccion de historial.
**Tags:** thin-file, score-alternativo, construccion-historial, afiliado-iess, monto-bajo

---

## Regla SCO-003 — Sin reporte en bureau, primer credito formal

**Aplica si:** Equifax retorna persona sin historial crediticio (thin-file puro), solicitante afiliado al IESS con antiguedad mayor o igual a 12 meses, y score alternativo mayor o igual a 60.
**Accion:** aprobar producto "Mi Primer Credito" con monto maximo USD 800 y plazo 12 meses. Reporte obligatorio a bureau para construir historial.
**Justificacion:** solicitantes sin historial son una poblacion subatendida; el score alternativo y la estabilidad laboral nos dan senal suficiente para entrar con ticket pequeno controlado.
**Tags:** thin-file, primer-credito, score-alternativo, afiliado-iess, inclusion-financiera

---

## Regla MIC-005 — Recargo por solicitante con multiples hard inquiries recientes

**Aplica si:** bureau reporta 3 o mas hard inquiries en los ultimos 90 dias.
**Accion:** aplicar recargo de tasa del 2 por ciento sobre la tasa estandar; reducir monto aprobado al 70 por ciento del solicitado.
**Justificacion:** patron de busqueda agresiva de credito en corto plazo es senal de stress financiero; mitigamos con menor exposicion y precio mas alto.
**Tags:** hard-inquiries, multiples-consultas, stress-financiero, recargo-tasa, monto-reducido

---

## Regla GAR-003 — Sin garantia para ingresos altos verificados

**Aplica si:** ingreso mensual demostrado mayor o igual a USD 1,800, antiguedad laboral mayor o igual a 36 meses, y score Equifax mayor o igual a 700.
**Accion:** sin requerimiento de garantia para montos hasta USD 8,000. Tasa preferencial.
**Justificacion:** combinacion de ingreso alto, antiguedad solida y score saludable indica perfil de muy bajo riesgo; el costo de gestionar garantia no se justifica para esta poblacion.
**Tags:** sin-garantia, ingreso-alto, antiguedad-alta, score-alto, perfil-premium
