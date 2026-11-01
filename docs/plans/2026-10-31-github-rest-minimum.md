---
status: in-progress
type: feature
prs: [22]
issue: 21
---

# agent-kitchen sube github-rest al mínimo de issue-flow

## En simple

**Decisión:** agent-kitchen sube github-rest al mínimo que pide la versión de issue-flow del repo.

### Hoy: github-rest viejo queda atrás
Al subir issue-flow a 0.3.0, apply deja github-rest 0.2.1 con un aviso ([V1](#v1)). El doctor del flujo queda en ✗ ([V2](#v2)).

### Después: un paso lo sube
apply ofrece "Subir github-rest 0.2.1 → 0.3.0", detrás del paso del flujo ([etapa 1](#etapa-1)). Con 0.3.0 o más, no hay paso.

**Fuera:** bajar github-rest, fijar uno más nuevo que el mínimo, tocar un rango y cambiar issue-flow.

## Etapas

| # | Etapa | Estado | PR |
|---|---|---|---|
| 1 | Paso que sube github-rest al mínimo de issue-flow | en curso | [#22](https://github.com/ramon-sg/agent-kitchen/pull/22) |

## Decisiones propias

- **El mínimo sale de `npm view @ramon-sg/issue-flow@<versión> dependencies`,** el piso de su rango (`^0.3.0` da 0.3.0), como lo calcula el propio flujo ([V3](#v3)). Es el contrato; el texto del aviso o del doctor no. Si npm no responde, no hay paso.
- **La versión es la que el repo tendrá:** la última si el flujo se instala o actualiza, la del repo si está al día. Solo desde 0.3.0: antes, `upgrade` ya subía github-rest ([V4](#v4)).
- **Es un paso propio de la pieza issue-flow,** entre el del flujo y el de labels, para poder desmarcarlo. Al correr, solo sube si el repo ya tiene esa versión del flujo (como el de labels) y github-rest sigue siendo una versión exacta menor. Usa `setDependency`, como skills-manager ([V5](#v5)).
- **Sin github-rest no hay paso:** apply lo agrega en el mínimo ([V1](#v1)). Un rango no se toca y no cambia el estado de la pieza: el doctor del flujo ya lo marca ([V2](#v2)).
- **La versión se lee como en el resto de agent-kitchen,** `devDependencies` primero. Un github-rest en los dos campos queda fuera: issue-flow lee primero `dependencies`, y el doctor del flujo lo seguiría marcando.
- **El paso no descarga nada** (`downloads: []`): solo edita package.json.
- **El aviso `kept` de apply sigue como nota,** aunque el paso siguiente lo arregle: filtrarlo depende de su texto.
- **Sin cambios en `agent-kitchen doctor`:** ya muestra el check de github-rest del doctor del flujo ([V2](#v2)).

## Contraste con la realidad

2026-10-31, rama `feat/21-github-rest-minimum`, commit `1b1f5d7`; issue-flow en la tag `v0.3.0` (la última en npm es 0.3.1, que pide lo mismo).

| Id | Afirmación | Evidencia | Resultado |
|---|---|---|---|
| <a id="v1"></a>V1 | apply agrega github-rest en el mínimo si falta; si lo tiene bajo el mínimo, lo deja con "kept … raise it" | issue-flow v0.3.0 `src/package-edits.ts:159-162` | ✔ |
| <a id="v2"></a>V2 | El doctor del flujo tiene un check `@ramon-sg/github-rest` que falla bajo el mínimo, y agent-kitchen doctor muestra los checks del flujo | issue-flow v0.3.0 `src/commands/doctor.ts:68-73`; `src/pieces/issue-flow.ts` (`issueFlowChecks`) | ✔ |
| <a id="v3"></a>V3 | El mínimo es el rango de github-rest en las dependencies del flujo, sin `^` ni `~` | issue-flow v0.3.0 `src/setup-files.ts` (`ownVersions`); `npm view @ramon-sg/issue-flow@0.3.0 dependencies --json` = `{"@ramon-sg/github-rest": "^0.3.0"}`; 0.3.1 da lo mismo | ✔ |
| <a id="v4"></a>V4 | Antes de 0.3.0 agent-kitchen actualiza con `upgrade`, que subía github-rest | `src/pieces/issue-flow.ts` (`stepFor`); issue-flow v0.2.7 `src/commands/upgrade.ts:3-4` | ✔ |
| <a id="v5"></a>V5 | `setDependency` cambia una versión sin tocar el resto del package.json | `src/repo.ts` (`setDependency`); `src/pieces/skills-manager.ts` | ✔ |

## Detalle para agentes

### <a id="etapa-1"></a>Etapa 1: paso que sube github-rest

- **Archivos:**
  - `src/tools.ts`: `npmDependencies(spec)` con `npm view <spec> dependencies --json`, el mismo tope y caché que `npmLatest` (`once` pasa a ser genérico); null si falla, sale vacío o no es un objeto.
  - `src/pieces/issue-flow.ts`: `GITHUB_REST`; `restMinimum(version)` (null antes de 0.3.0 o sin dato); `restStep(version, minimum, current)`. `issueFlowStatus` lo busca en paralelo con labels y doctor, para `target`, y agrega el paso entre el del flujo y el de labels si package.json tiene una versión exacta menor. Encabezado del archivo actualizado.
  - `test/fake-tools.mjs`: `npm view <pkg>@<v> dependencies --json` imprime `FAKE_NPM_DEPS[<pkg>@<v>]`, o falla. Va antes de la respuesta de `version`, que hoy no mira `args[2]`.
  - `test/helpers.mjs`: `npmCalls()`, las llamadas a npm del log. Sin valor por defecto de `FAKE_NPM_DEPS`: los tests que no lo fijan no ven el paso.
  - `README.md` (excepciones que escribe agent-kitchen) y `docs/agent-guide.md` (fila de package.json y tabla de versiones).
- **Tests, en orden** (`test/github-rest.test.mjs`):
  1. De 0.2.7 a 0.3.0 con github-rest 0.2.1 y mínimo `^0.3.0`: se ofrece "Subir github-rest 0.2.1 → 0.3.0" y deja 0.3.0. Falla hoy.
  2. En 0.3.0 al día con github-rest 0.2.1: se ofrece y lo sube.
  3. Con github-rest 0.3.0 o 0.4.0, o con un rango: no hay paso.
  4. Si la actualización del flujo falla, el paso no sube nada y lo dice.
  5. Con npm sin respuesta para las dependencies: no hay paso. Con 0.2.6 en npm: no se pregunta a npm por las dependencies.
  6. De 0.3.0 a 0.3.1 con mínimos distintos (0.3.0 y 0.4.0) y github-rest 0.3.0: usa el de 0.3.1 y sube a 0.4.0.
- **Siguen pasando, sin cambios:** `test/flow-apply.test.mjs`, `test/sync.test.mjs`, `test/doctor.test.mjs`, `test/labels.test.mjs`. No fijan `FAKE_NPM_DEPS`, así que no ven el paso; los tests 1–6 prueban la ruta nueva.
- **Ojo:** el mínimo es el de la versión que queda, no el de la que había. El paso relee package.json al correr: Dependabot puede haberlo cambiado. Una lectura más de npm no debe colgar el menú sin red.
- **Hecho cuando:** `npm test` pasa. En un repo temporal con issue-flow 0.2.7 y github-rest 0.2.1, `AGENT_KITCHEN_HANDED_OVER=1 node <worktree>/dist/cli.js apply --yes --skip claude-cloud,claude-repo-guard,skills,agents-md` deja issue-flow en la última de npm y github-rest 0.3.0, y el `doctor` del flujo en esa versión no marca github-rest.

## Desvíos

- Etapa 1: `npm test` pasa con 96 tests (6 nuevos en `test/github-rest.test.mjs`). Cinco mutaciones dan rojo: el mínimo de la versión anterior, sin la guarda de versión del flujo, sin el corte en 0.3.0, el mínimo contado como bajo y un rango tocado. Con npm real, en un repo temporal con issue-flow 0.2.7 y github-rest 0.2.1: `apply --yes` deja issue-flow 0.3.1 y github-rest 0.3.0, y el doctor de 0.3.1 marca github-rest ✓. Desvíos:
  - Los tests van en un archivo propio, `test/github-rest.test.mjs`, no en `test/flow-apply.test.mjs`.
  - Por `code-audit`: ningún test pasa por la relectura de package.json al correr ("ya tenía una versión que sirve"). Por la CLI nada sube github-rest antes de este paso en la misma corrida; queda como red de seguridad, sin test.
