# Domain Docs

Como las skills de engineering deben consumir la documentacion de dominio cuando exploran el codigo de este repo.

## Antes de explorar, leer

- **`CONTEXT.md`** en la raiz del repo — glosario y lenguaje del dominio (microcredito en cooperativa EC).
- **`docs/adr/`** — ADRs que toquen el area en la que estes a punto de trabajar.

Si alguno no existe, **proceder en silencio**. No flaguees ausencias ni sugieras crearlos por adelantado. Las skills productoras (`/grill-with-docs`) los crean perezosamente cuando un termino o decision se cristaliza.

## Estructura de archivos

Este repo es **single-context** (un solo dominio: motor de microcredito):

```
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   │   ├── 0001-typescript-langgraph-stack.md
│   │   ├── 0002-mocked-external-services.md
│   │   └── ...
│   └── architecture/
│       └── 00-overview.md
└── src/
```

NO existe `CONTEXT-MAP.md` y no se planea pasar a multi-context (no es monorepo).

## Usar el vocabulario del glosario

Cuando tu output nombre un concepto del dominio (titulo de issue, propuesta de refactor, hipotesis, nombre de test), usar el termino tal como esta en `CONTEXT.md`. No deslizarse a sinonimos que el glosario evita explicitamente.

Si el concepto que necesitas no esta en el glosario:
- **Re-evaluar primero**: capaz estas inventando lenguaje que el proyecto no usa.
- **O hay un gap real**: notarlo para la proxima sesion de `/grill-with-docs`.

## Flag de conflictos con ADRs

Si tu propuesta contradice un ADR existente, exponelo explicitamente en vez de pisarlo en silencio:

> _Contradice ADR-0002 (mocked-external-services) — pero vale la pena reabrir porque…_
