# ADR-0002 — Mocks 100% para servicios externos

**Status:** Accepted
**Date:** 2026-05-03
**Deciders:** Raul Camacho

---

## Context

El sistema necesita consultar 4 servicios externos durante el procesamiento de una solicitud de microcredito:

- Registro Civil (validar cedula y nombre)
- IESS (verificar afiliacion laboral e ingresos)
- Equifax / BIQ (buro de credito)
- Score alternativo (algun servicio sintetico)

Necesitamos decidir si conectar a APIs reales (donde existan), simular completamente, o mezclar.

## Decision

**Mocks 100% para los 4 servicios.** No conectar a APIs reales en este demo.

## Rationale

1. **El demo se usa en pitch a clientes en vivo.** Si alguna API externa esta caida durante la demo, queda mal. Riesgo inaceptable.
2. **Las APIs reales requieren credenciales / contratos.** El demo es publico y reusable — no podemos pedir a cada fork que tramite acceso a buro de credito.
3. **El proposito del demo es mostrar la arquitectura, no la integracion real.** Los mocks deben simular suficientemente bien (incluyendo fallos, latencias y errores realistas) para que los patrones de circuit breaker y saga se vean en accion.
4. **Mantenibilidad cero del demo.** Si APIs reales cambian, el demo se rompe sin que lo sepamos.
5. **Los mocks pueden ser MUY realistas.** Patrones de respuesta de Equifax son publicos (en docs de credit unions). Los podemos sintetizar bien.

## Consequences

### Positivas

- Demo corre 100% offline o con sola conexion al LLM
- Cero dependencia de credenciales externas
- Los fallos pueden simularse a voluntad para demostrar circuit breakers
- Repo publico clonable y corrible por cualquiera

### Negativas

- Un prospect podria pensar que no es "real" — hay que comunicar claramente que es demo y los mocks reflejan APIs reales
- Cuando se haga el primer cliente real, hay que reemplazar los mocks (pero la arquitectura no cambia)

### Mitigacion

- Cada mock tiene `MOCK_` prefix en su nombre y comentario claro al inicio explicando que simula
- README dice explicitamente "external services are mocked"
- Estructura de respuesta de mocks coincide al 100% con la docs publica de las APIs reales
- Los mocks tienen modos: `happy_path`, `slow`, `error`, `flaky` — configurables via UI para que la demo pueda mostrar circuit breakers en vivo

## Mocks a implementar

| Mock | Que simula | Modos |
|---|---|---|
| `MOCK_RegistroCivil` | API del Registro Civil EC para validar cedula | happy, slow (3s), error_500, not_found |
| `MOCK_IESS` | Afiliacion laboral, sueldo declarado | happy, slow (8s), error_503, sin_afiliacion |
| `MOCK_Equifax` | Score crediticio, historial, deudas | happy, slow (5s), error_429, score_bajo, score_alto |
| `MOCK_ScoreAlternativo` | Score sintetico de patrones de gasto | happy, slow (2s), error_500, sin_data |

Cada mock expone:
- `setMode(mode)` — para forzar comportamiento desde la UI del demo
- `getCallStats()` — para mostrar cuantos calls llegaron y cuantos fallaron

## Open questions

- ¿Los mocks viven dentro del repo o en un microservicio separado? Default: dentro del repo, como un modulo `services/mocks/`. Permite cambiar a HTTP real reemplazando solo la implementacion.
- ¿Los datos de "personas" para los mocks vienen de un dataset sintetico (pendiente de generar) o son hardcoded? Default: dataset sintetico de 50-100 personas con perfiles variados (buen pagador, riesgo, sin historia, etc.).
