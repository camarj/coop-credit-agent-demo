# Vision humana del sistema

> Lectura recomendada **antes** de `architecture/00-overview.md`. Este documento explica que hace el sistema y por que cada pieza existe, sin jerga tecnica. El overview de arquitectura se ocupa del "como" tecnico.

---

## El sistema, en 2 oraciones

Una persona pide un microcredito en una cooperativa ecuatoriana. El sistema valida la solicitud paso a paso contra varias fuentes de datos, consulta la politica de credito de la cooperativa, y le entrega al oficial humano una decision sugerida ("aprobar / rechazar / revisar") con su justificacion completa y todo el rastro de lo que paso.

---

## El flujo, narrado como si fuera una pelicula

Maria quiere $3,000 a 24 meses. Llena un form en la web de la cooperativa.

1. **Recepcion (intake).** El sistema valida que los datos esten bien formateados — cedula con 10 digitos y provincia valida, monto entre $100 y $50,000, plazo razonable. Si algo esta mal, le dice a Maria al toque.

2. **Identidad.** Valida la cedula contra el Registro Civil. Confirma que existe, que pertenece a Maria, que no esta marcada como fallecida.

3. **Empleo e ingresos.** Consulta al IESS si Maria esta afiliada y cuanto declara ganar. Confirma o no lo que Maria puso en el form.

4. **Buro de credito.** Pide a Equifax el score crediticio, el historial de pagos, las deudas vigentes. Esto cuesta plata real (cada consulta) y queda registrada como "hard inquiry".

5. **Score alternativo.** Otra fuente que mira patrones de gasto / digital footprint para complementar el buro tradicional. Util para clientes sin historial bancario.

6. **Politica de la cooperativa.** El sistema lee la politica interna ("score < 600 → rechazar", "ratio cuota/ingreso > 40% → revisar", etc.) y la aplica al caso de Maria. La politica vive como un documento que la cooperativa escribe — no esta hardcoded en el codigo.

7. **Decision.** Combina todo y emite: APROBADA / RECHAZADA / REVISAR + razon citando que parte de la politica aplico + nivel de confianza. Si la confianza es baja (caso ambiguo), automaticamente lo manda a REVISAR para que un humano decida.

8. **Entrega al oficial.** El oficial de credito de la cooperativa abre el panel, ve la decision sugerida con todo el rastro detras, y aprueba u override en su pantalla.

Todo esto pasa en ~10-30 segundos.

---

## Las 6 piezas moviles

| Pieza | Que es | Por que existe |
|---|---|---|
| **Orchestrator** | El director de orquesta. Decide quien corre cuando. | Sin un director, los agentes se pisan, se pierden datos, no se puede auditar. La cooperativa tiene SBS encima — necesita un solo lugar que sepa todo lo que paso. |
| **7 Agentes** (intake, identity, income, bureau, alt_score, policy, decision) | Cada uno hace UNA cosa bien. | Si un solo agente hiciera todo, no podriamos cambiar el buro sin tocar el codigo de validacion. Separados son intercambiables. |
| **Estado versionado** (en Postgres) | Una linea de tiempo append-only. v0 = intake, v1 = identidad, v2 = ingresos, etc. Nadie modifica versiones anteriores. | Si v3 sobreescribiera v2, perderiamos la traza de "que sabia el sistema cuando consulto buro". Apilar versiones nuevas = auditoria perfecta. |
| **Mocks** (RegistroCivil, IESS, Equifax, AltScore) | Servicios externos simulados con respuestas verosimiles. | Para que el demo corra en cualquier laptop sin depender de credenciales reales ni de que las APIs reales esten arriba el dia del pitch. |
| **Circuit breakers** | Una valvula de seguridad alrededor de cada llamada externa. Tras 5 fallos seguidos se "abre" y deja de intentar por 60s. | Equifax se cae. Cuando se cae, sin breaker el sistema queda colgado esperando. Con breaker, falla rapido y avisa. |
| **Saga / compensate** | Un mecanismo de "deshacer" si algo falla a mitad de camino. Cada agente sabe como deshacer su accion. | Si pedimos un hard inquiry a Equifax (cuesta plata + impacta el score) y despues la politica rechaza, el saga elimina ese hard inquiry. Sin saga, dejamos basura colgando. |

---

## Lo que ve un humano en el demo

Tres pantallas simples:

**Pantalla 1 — Form.** Maria llena 4 campos (cedula, ingresos, monto, plazo) y aprieta "Procesar".

**Pantalla 2 — El cerebro pensando en vivo.** A la derecha aparece un grafo con los 7 agentes. A medida que corren, se iluminan en orden. Click en cualquiera y ves un panel lateral mostrando que esta pensando ese agente: *"consultando Equifax... score 720, dos hard inquiries en los ultimos 6 meses... pasando al siguiente"*. Como pensar en voz alta.

**Pantalla 3 — La decision con toda la evidencia.** Card grande: *"APROBADA. Confianza 87%. Razon: cumple politica seccion 3.2 (score > 700, ratio cuota/ingreso 28%, sin moras vigentes)."* Con link al rastro completo en una pestana de auditoria.

**Boton secreto del demo:** "tumbar Equifax". Lo apretas y la proxima solicitud se traba en el agente bureau, ves el circuit breaker abrirse, y el saga corriendo hacia atras limpiando los efectos. Ese es el momento *"miren, esto NO se rompe en produccion"*.

---

## Que lo hace "apto para produccion" (no demo de Twitter)

Tres ideas que la mayoria de demos de IA no tienen:

1. **Todo lo que el sistema hizo es reconstruible.** Si dentro de 6 meses una cooperativa pregunta *"¿por que rechazaron a este cliente en abril?"*, abrimos el rastro y vemos exactamente con que datos, contra que version de la politica, y con que justificacion.

2. **Cuando algo se rompe, el sistema se entera y reacciona.** No queda colgado. No reintenta infinito. No deja efectos colaterales sucios. Falla limpio y avisa.

3. **El humano tiene la ultima palabra.** El sistema NUNCA aprueba un credito por si mismo. Sugiere. El oficial decide. Si la sugerencia tiene baja confianza, el sistema mismo la marca para revision.

---

## Lo que NO hace este demo

- No conecta a APIs reales (todo mockeado, por seguridad de pitch)
- No desembolsa plata
- No firma contratos
- No reemplaza al oficial — lo asiste
- No tiene login multiusuario, no es SaaS, no soporta multi-cooperativa

---

## La metafora corta

Es **un becario super rapido y disciplinado** que prepara el expediente de cada solicitud antes de que llegue a tu escritorio. Hace las consultas, junta la evidencia, te entrega un resumen con su recomendacion. Vos decidis.

La diferencia con un becario humano: nunca olvida hacer un paso, nunca pierde un documento, deja el rastro perfecto, y si algo se rompe en el camino, te avisa antes de que el cliente se entere.

---

## Para profundizar

- **Como funciona tecnicamente:** `docs/architecture/00-overview.md`
- **Lenguaje compartido del dominio:** `CONTEXT.md`
- **Decisiones arquitectonicas con su porque:** `docs/adr/`
- **Reglas duras del proyecto:** `.claude/rules/`

---

*Creado: 2026-05-04. Mantener actualizado cuando cambien las piezas moviles o el alcance del demo.*
