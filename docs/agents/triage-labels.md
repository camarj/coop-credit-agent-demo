# Triage Labels

Las skills de Pocock hablan en terminos de cinco roles canonicos de triage. Este archivo mapea esos roles a las labels que efectivamente existen en el issue tracker de este repo (GitHub Issues en `camarj/coop-credit-agent-demo`).

| Rol canonico       | Label en este repo  | Significado                                  |
| ------------------ | ------------------- | -------------------------------------------- |
| `needs-triage`     | `needs-triage`      | Maintainer necesita evaluar la issue         |
| `needs-info`       | `needs-info`        | Esperando mas info del reporter              |
| `ready-for-agent`  | `ready-for-agent`   | Spec completa, lista para que un AFK agent la agarre |
| `ready-for-human`  | `ready-for-human`   | Requiere implementacion humana               |
| `wontfix`          | `wontfix`           | No se va a actuar sobre esto                 |

Cuando una skill mencione un rol (ej. "apply the AFK-ready triage label"), usar el string de la columna derecha.

## Maquina de estados de triage

```
[issue creada]
      ↓
 needs-triage ─────► wontfix
      │
      ├──► needs-info  ─────► (vuelve a needs-triage cuando llega info)
      │
      ├──► ready-for-agent
      │
      └──► ready-for-human
```

## Crear / sincronizar las labels en GitHub

Las cinco labels ya estan creadas en `camarj/coop-credit-agent-demo`. Para recrearlas en otro repo:

```bash
gh label create needs-triage    --color FBCA04 --description "Maintainer needs to evaluate this issue"
gh label create needs-info      --color D4C5F9 --description "Waiting on reporter for more information"
gh label create ready-for-agent --color 0E8A16 --description "Fully specified, ready for an AFK agent"
gh label create ready-for-human --color 1D76DB --description "Requires human implementation"
gh label create wontfix         --color FFFFFF --description "Will not be actioned"
```

Si en el futuro quiero renombrar (ej. `lista-para-agente` en espanol), cambio la columna derecha de la tabla y regenero las labels — la skill `/triage` se adapta automaticamente.
