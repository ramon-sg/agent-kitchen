---
status: applied
type: feature
prs: [24]
issue: 23
---

# apply --commit: revisa, instala y pregunta qué hacer con los cambios

## En simple

**Decisión:** con la opción commit, agent-kitchen deja los cambios de apply commiteados donde la persona elija.

### Hoy: el commit queda para después
Apply termina pidiendo correr el install y commitear a mano ([V1](#v1)). Muchas veces lo hace el agente, y el guard lo frena.

### Después: una pregunta al final
Apply revisa que el repo esté limpio y en la base. Instala si cambió package.json. Luego ofrece commit en la base, en una rama o con PR ([etapa 1](#etapa-1)).

### Riesgo: la pregunta tras el spinner
Una pregunta después de un spinner puede no escuchar el teclado ([V5](#v5)). Con la opción, los pasos se muestran en líneas simples.

**Fuera:** push a la base, mergear el PR, preguntar sin la opción.

## Etapas

| # | Etapa | Estado | PR |
|---|---|---|---|
| 1 | `apply --commit`: revisión previa, install, pregunta final y commit, rama o PR | implementada | [#24](https://github.com/ramon-sg/agent-kitchen/pull/24) |

## Decisiones propias

- **Los worktrees no ensucian el repo.** `.claude/worktrees/` no está en `.gitignore` y git lo lista como sin seguimiento ([V3](#v3)). La revisión ignora las rutas de `git worktree list`. Si no, `--commit` fallaría siempre en repos con el flujo. Los archivos sin seguimiento fuera de worktrees sí cuentan como cambios.
- **Se commitea lo que cambió durante apply:** `git status --porcelain -uall` antes y después, sin las rutas de worktrees. Nunca `git add -A`.
- **Base:** la misma regla que issue-flow: `baseBranch` de `.agents/flow.json`, si no `origin/HEAD`, si no `main` ([V7](#v7)).
- **Rama y PR, pasando un momento por la rama:** `git switch -c <rama>` (los cambios viajan), commit ahí, push y PR si se eligió, y `git switch <base>`. La copia principal, la única donde corre apply ([V4](#v4)), termina en la base. Así un hook que prohíbe commitear en la base no bloquea la rama. Sale de la regla 6 de la guía solo dentro del comando; la guía lo dice.
- **Si el commit falla** (un hook), vuelve a la base con los cambios, borra la rama vacía con `git branch -d` y sale con 1.
- **Commit en la base:** commit normal ahí, sin push.
- **Nombre:** `chore/agent-kitchen-apply-<AAAA-MM-DD>`; si existe en local o en `refs/remotes/origin`, `-2`, `-3`… Sin consultar la red.
- **PR con `github-rest pr create`** listo para revisión, antes de volver a la base. Versión: la exacta del `package.json` de la rama; si es un rango o falta, la última de npm. Sin versión, el PR falla con el comando para reintentar ([V6](#v6)). Se corre sin `GH_REPO` en el entorno, para que el repo salga de `origin`.
- **Si falla el push o el PR**, la rama local queda, la copia vuelve a la base y la salida dice qué correr.
- **Después de rama o PR**, `node_modules` queda con lo de la rama: la salida lo dice y sugiere `<gestor> install` en la base.
- **Pasos que fallaron:** en terminal se pregunta igual, con un aviso arriba; "Dejar sin commit" sigue por defecto. Con `--yes`, no hay commit ni PR y sale con 1.
- **`--commit --dry-run`:** hace la revisión previa (sale con 1 si falla) y lista los pasos; no escribe ni pregunta.
- **`--commit --yes`** elige rama con PR. Sin terminal y sin `--yes`, apply ya no corre pasos ([V2](#v2)). La guía dice que un agente no pasa `--commit --yes` sin el OK de la persona (regla 1).
- **Mensaje final con `--commit`:** dice qué se hizo (commit, rama, URL del PR) en vez de "Falta: corre install…". Con "dejar", "Falta: revisa el diff y haz commit".

## Contraste con la realidad

2026-11-01, rama `feat/23-apply-commit`, commit `70a0d20`.

| Id | Afirmación | Evidencia | Resultado |
|---|---|---|---|
| <a id="v1"></a>V1 | Apply termina con "corre '<gestor> install', revisa el diff y haz commit"; el gestor sale de `packageManager` | `src/commands/sync.ts:249`; `src/repo.ts:113`; `test/sync.test.mjs:44` | ✔ |
| <a id="v2"></a>V2 | Sin terminal y sin `--yes`, apply solo muestra los pasos | `src/commands/sync.ts:143`, `:238` | ✔ |
| <a id="v3"></a>V3 | En la copia principal, git lista el worktree como `?? .claude/worktrees/<n>/`, y `git worktree list --porcelain` da su ruta. Ninguna herramienta del sistema lo agrega a `.gitignore` | `git status --porcelain -uall`; issue-flow `src/config.ts:75` | ✔ |
| <a id="v4"></a>V4 | Apply corre solo en la copia principal | `src/commands/sync.ts:221`; `src/repo.ts:40-46` | ✔ |
| <a id="v5"></a>V5 | Un spinner antes de una pregunta deja sorda la pregunta siguiente (`@clack/prompts` 1.8.1) | comentario en `src/commands/sync.ts:159-163` | ✔ (dicho en el código, no reprobado) |
| <a id="v6"></a>V6 | `github-rest pr create --head --base --title --body-file` imprime la URL; el repo sale de `-R`, `GH_REPO` u `origin`, en ese orden | github-rest v0.3.0 `src/pr-commands.ts:26-52`, `src/args.ts:150-155` | ✔ corregida: decía solo `origin` |
| <a id="v7"></a>V7 | issue-flow toma la base de `baseBranch`, luego `origin/HEAD`, luego `main` | issue-flow `src/commands/worktree.ts:43-47` | ✔ |

## Detalle para agentes

### <a id="etapa-1"></a>Etapa 1: `apply --commit`

- **Archivos:**
  - `src/git-finish.ts` (nuevo): `baseBranch(root)`, `checkReady(root, base)` (lanza `KitError`: cambios, rama distinta, HEAD suelto), `changedPaths(root)` (porcelain `-uall` sin worktrees), `branchName(root, date)` y `finish(root, choice, { steps, base, paths })` con `choice` = `"leave" | "base" | "branch" | "pr"`. Devuelve las líneas a mostrar y si salió bien.
  - `src/commands/sync.ts`: `SyncOptions.commit`. Con `commit`: `checkReady` antes de cualquier paso (también con `--dry-run`), `progressFor` con líneas simples, y al final install si cambió `package.json`, `git status --short`, la pregunta y `finish`. Sin `commit`, igual que hoy.
  - `src/menu.ts`: `askFinish(base, branch)`: cuatro opciones, "Dejar sin commit" con `initialValue`; cancelar = dejar.
  - `src/tools.ts`: `runInstall(root, manager)` nuevo (no existe nada parecido), callado salvo si falla o con `--verbose`.
  - `src/cli.ts`: flag `commit` (boolean) y su ayuda; `doctor` lo rechaza (`:100`).
  - `README.md` y `docs/agent-guide.md`: `--commit`, sus opciones, el paso por la rama, que el commit sale de la terminal de la persona, y que un agente no usa `--commit --yes` sin OK.
  - `test/helpers.mjs`: `GIT_ENV` también en el `env` de `cli()`; `installedRepo({ commit: true })` commitea lo que escribe; un `origin` bare opcional con `origin/HEAD`; falsos de `bun`, `pnpm` y `yarn` en `bin`.
  - `test/fake-tools.mjs`: `npm install` (y los otros gestores) escribe el lockfile, falla con `FAKE_FAIL`; `github-rest pr create` registra sus argumentos e imprime una URL, o falla con `FAKE_FAIL`.
- **Tests, en orden** (`test/apply-commit.test.mjs`, CLI de `dist/` y `finish` de `dist/git-finish.js` con `GIT_ENV`):
  1. `apply --commit --yes` con un archivo con seguimiento cambiado sale con 1, dice "cambios" y no corre pasos. Falla hoy (flag desconocida).
  2. Lo mismo con solo un archivo sin seguimiento.
  3. Con un worktree en `.claude/worktrees/`, la revisión pasa.
  4. En una rama que no es la base, sale con 1 y la nombra. Con `--dry-run` también.
  5. Un paso que cambia `package.json` hace correr `npm install`; el lockfile queda en el commit.
  6. Si el install falla, no hay commit, sale con 1 y los cambios quedan.
  7. `--commit --yes`: la copia queda en `main`, limpia y en el commit de antes; la rama del día tiene un commit `chore: agent-kitchen apply` con los pasos y está en el remoto; `pr create` recibió `--head` esa rama y `--base main`; la salida muestra la URL.
  8. Con `GH_REPO` en el entorno, `pr create` corre sin él.
  9. Si `pr create` falla, la rama sigue en el remoto, la copia está en `main` y la salida dice el comando.
  10. `finish(..., "base")`: un commit en `main`, nada en el remoto.
  11. `finish(..., "branch")`: rama local con el commit, `main` sin cambios ni commits, nada en el remoto.
  12. Un `pre-commit` que rechaza commits en `main`: "branch" funciona; "base" falla, deja los cambios y sale con 1.
  13. Un `pre-commit` que falla siempre: "branch" vuelve a `main` con los cambios y la rama no existe.
  14. Si la rama del día existe en local o en `refs/remotes/origin`, usa `-2`.
  15. Con un paso que falla y `--yes`, no hay commit ni rama y sale con 1.
  16. Sin pasos que cambien archivos, no hay commit.
  17. Sin `--commit`, con cambios sin commitear, apply corre como hoy y no commitea.
- **Siguen pasando:** `test/sync.test.mjs` (el mensaje de `:44` y el flujo sin `--commit`), `test/cli.test.mjs` (más `doctor --commit` da error de uso), `test/unit.test.mjs`.
- **Ojo:** `git switch <base>` va siempre al final, también si falla el push o el PR. Nunca `git branch -D`, `reset --hard` ni `--no-verify`. El install puede cambiar más que el lockfile; entra porque cambió durante apply. La pregunta no puede venir después de un spinner ([V5](#v5)): pruébalo a mano en una terminal.
- **Hecho cuando:** `npm test` pasa. En un repo temporal con un `origin` local, `node <worktree>/dist/cli.js apply --commit` en una terminal muestra la pregunta, responde al teclado y cada opción deja el repo como dice.

## Desvíos

- Etapa 1: `npm test` pasa con 118 tests (22 nuevos en `test/apply-commit.test.mjs`). Seis mutaciones dan rojo: sin el filtro de worktrees, sin quitar `GH_REPO`, sin mirar `origin` para el `-2`, sin volver a la base si falla el commit, sin volver a la base al terminar, y sin `--literal-pathspecs`. La pregunta final, probada con `script` (una terminal falsa) en un repo temporal: dos flechas abajo y Enter dejan la rama creada y la copia en `main`. Desvíos:
  - `finish` recibe `paths`, la misma lista que se muestra, y commitea con `--literal-pathspecs`; así no entra un archivo tocado mientras la pregunta espera. Lo pidió `code-audit`.
  - La vuelta a la base va en un `finally`, también si algo lanza entre el `switch -c` y el final, y avisa si no pudo volver.
  - El paso del install se muestra con líneas simples, sin spinner, como los pasos.
  - Los falsos suman `pnpm install` y `npm install` (escriben el lockfile) y `github-rest pr create`; el log de llamadas guarda `GH_REPO`.
  - Sin cubrir con test: "sin cambios" con salida 0, porque no hay un paso falso que corra bien sin escribir nada.
