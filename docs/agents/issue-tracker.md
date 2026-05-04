# Issue tracker: GitHub

Issues, PRDs y bugs de este repo viven como GitHub Issues en `camarj/coop-credit-agent-demo`. Se usa la CLI `gh` para todas las operaciones — `gh` infiere el repo automaticamente cuando corre dentro del clone.

## Convenciones

- **Crear issue**: `gh issue create --title "..." --body "..."`. Para bodies multilinea usar heredoc.
- **Leer issue**: `gh issue view <number> --comments`.
- **Listar issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` con filtros `--label` y `--state` segun haga falta.
- **Comentar**: `gh issue comment <number> --body "..."`
- **Aplicar / quitar labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Cerrar**: `gh issue close <number> --comment "..."`

## Cuando una skill dice "publish to the issue tracker"

Crear un GitHub issue con `gh issue create`.

## Cuando una skill dice "fetch the relevant ticket"

Correr `gh issue view <number> --comments`.

## Convenciones extra de este proyecto

- **Idioma**: titulos y bodies en espanol (excepto fragmentos tecnicos que naturalmente van en ingles, ej. nombres de archivos, comandos, terminos de stack).
- **Vertical slices**: cada issue de feature debe poder mapearse a una vertical slice segun `.claude/rules/vertical-slices.md`. Si una propuesta no toca DB+logica+UI, probablemente es una capa horizontal disfrazada — re-cortarla antes de crear la issue.
- **Labels de triage**: ver `docs/agents/triage-labels.md`. La skill `/triage` aplica esas labels en transiciones de estado.
- **Linkeo a ADRs**: si la issue se motiva en una decision arquitectonica documentada, citarla en el body como `Ver ADR-NNNN`.
