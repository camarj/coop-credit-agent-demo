# TDD no es negociable en este proyecto

Pocock lo dejo claro: cuando trabajas con agentes de IA, TDD no es opcional. Sin tests, el agente programa a ciegas y tiende a hacer trampa (escribir codigo primero y tests despues "para que pasen").

## Regla dura

**Antes de escribir codigo de produccion, debe existir un test que falle.**

Flow obligatorio (red-green-refactor):

1. **Red** — escribe un test que describa el comportamiento deseado. El test DEBE fallar al correrlo.
2. **Green** — escribe el codigo MINIMO para que ese test pase. Nada mas.
3. **Refactor** — ahora si, mejora la implementacion. El test sigue verde.

## Cuando aplica

- Toda nueva funcionalidad de un agente
- Toda nueva API route
- Toda transformacion de datos no trivial
- Toda integracion entre agentes
- Todo bugfix (escribe primero el test que reproduce el bug)

## Cuando NO aplica

- Componentes UI puramente presentacionales (cubrir con Playwright E2E en su lugar)
- Configuracion de tooling (eslint, prettier, etc.)
- Migrations de DB (cubrir con tests de integracion del repository encima)

## Stack de testing decidido

- **Vitest** para unit + integration tests
- **Playwright** para E2E del flow completo de la UI
- **Testcontainers** o `pg-mem` para DB en tests (decidir en grilling)

## Anti-patrones que el agente debe evitar

- Escribir el codigo y despues tests "que validen lo que ya hice" — esto NO es TDD
- Tests que solo verifican que la funcion existe pero no su comportamiento
- Tests que mockean la cosa que se esta probando
- Tests sin assertions reales (solo `expect(true).toBe(true)` disfrazado)
- Saltarse el step de "ver el test fallar primero"

## Para usar la skill

```
/tdd
```

Carga el contexto de TDD y pone al agente en modo red-green-refactor estricto.
