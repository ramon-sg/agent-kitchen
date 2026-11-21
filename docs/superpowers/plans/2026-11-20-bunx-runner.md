# `agent-kitchen` con `.agents/runner.json` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `agent-kitchen` corra cada herramienta con el ejecutor y la versión de `.agents/runner.json` (Bun por defecto, sin `npx` fijo ni `node_modules`), migre los repos del modo viejo y se publique con sus dependencias adentro.

**Architecture:** `agent-kitchen` usa `@ramon-sg/runner` (empaquetada dentro al publicar) para leer el archivo y armar comandos. Un repo está en **modo runner** si tiene `.agents/runner.json`, y en **modo viejo** si no: el modo viejo sigue funcionando igual que hoy (`npx`, versiones en `package.json`) hasta que se migra. La Parte A solo necesita `@ramon-sg/runner` 1.0; la Parte B necesita además las versiones de las herramientas que leen `runner.json`.

**Tech Stack:** TypeScript 5.9 (ESM, `tsc`), esbuild para empaquetar, `node:test` sobre el CLI compilado, herramientas falsas de `test/fake-tools.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-20-bunx-runner-design.md`, secciones "`agent-kitchen`", "El `package.json` de los atajos", "Las herramientas se publican con sus dependencias adentro" y el paso 8 de "Orden entre repos".

## Global Constraints

- Archivo: `.agents/runner.json`; biblioteca: `@ramon-sg/runner` (siempre con scope), API de la spec "API pública (1.0)".
- Comando: `bun` → `bunx --bun <paquete>@<versión>`; `node` → `npx --yes <paquete>@<versión>`. Sin `runner`, `bun`.
- Modo viejo (sin `runner.json`): todo exactamente como hoy. Ningún test existente cambia de resultado en la Parte A.
- La migración es todo o nada: se ofrece solo si la versión a la que va cada herramienta instalada lee `runner.json`.
- `claude-repo-guard` en npm: `@ramon-sg/claude-repo-guard`, versión = número de su tag.
- El `package.json` publicado de `agent-kitchen` no tiene `dependencies`.
- Textos nuevos en `src/texts/es.ts` y `src/texts/en.ts`, con las mismas claves (lo revisa `test/texts.test.mjs`).
- Ningún commit, push, PR, merge ni publicación sin el OK del usuario para esa acción (`docs/agent-guide.md`, regla 1). Nunca `--no-verify`.
- `Check.status` de `agent-kitchen` es `"ok" | "fail" | "info"`: el `"warn"` de `@ramon-sg/runner` se muestra como `"info"`.

## Review Focus

1. Un repo en modo viejo (con `devDependencies` y sin `runner.json`) después de esta rama: `apply` y `doctor` hacen exactamente lo de antes, `npx` incluido. → Task A2 (los tests existentes) y un test nuevo en A2.
2. Una máquina con Bun y sin npm: las consultas de "la última versión" responden igual (no dependen de `npm view`). → Task A3.
3. `runner.json` inválido en un repo: `apply` y `doctor` terminan con el error de la biblioteca y la ruta, no con un stack. → Task A5.
4. Migrar un repo de Node con dependencias propias: su lockfile queda al día con el gestor de ese lockfile y sus dependencias siguen ahí. → Task B3.
5. Una herramienta instalada bajo la versión mínima que lee `runner.json`: la migración no se ofrece y la tabla dice cuál falta. → Task B3.

---

## Parte A — solo necesita `@ramon-sg/runner` 1.0

**Antes de empezar:** `npm view @ramon-sg/runner version` responde `1.0.0` o más. Si no, esta parte espera.

**Lo que dejó `@ramon-sg/runner` 1.0.0** (publicado el 2026-11-20, sin `dependencies`; spike en `docs/spike-2026-11-20.md` de ese repo):
- `--bun` sí gana sobre el shebang `#!/usr/bin/env node`.
- Bun no puede precargar la caché sin correr la herramienta: con Bun, `download` no hace nada.
- `npx` sin red se cuelga en vez de fallar: ningún test corre `npx` o `bunx` reales contra la red; usar siempre las herramientas falsas y `AGENT_KITCHEN_REGISTRY`.
- `writeRunnerConfig` lanza `TypeError` con una config inválida y escribe de forma atómica.
- Una versión exacta no acepta ceros a la izquierda (`01.2.3` es inválida).
- `writeScripts` solo escribe `packageManager` al crear el `package.json`; cambiarlo después le toca a `agent-kitchen` (Task B4).
- `checkToolPins` espera solo comandos de hooks y atajos: un texto que nombra la herramienta sin `@versión` es `fail`. No pasarle otros textos.
- Solo macOS/Linux en 1.x.

### Task A1: Publicar con las dependencias adentro

**Files:**
- Modify: `package.json` (scripts `build`, `dependencies` → `devDependencies`, agregar `esbuild` y `@ramon-sg/runner`), `test/pack.test.mjs`
- Create: `scripts/bundle.mjs`

**Interfaces:**
- Produces: `dist/cli.js` empaquetado y ejecutable; `npm run build` lo deja; `tsc --noEmit` sigue revisando tipos.

- [ ] **Step 1: Test que falla.** En `test/pack.test.mjs`: el paquete incluye `dist/cli.js`, `package.json`, `README.md`, `LICENSE`; no incluye `src/` ni `test/`; y el `package.json` empaquetado no tiene `dependencies` (o lo tiene vacío). Quitar del test la exigencia de `dist/pieces/issue-flow.js`.
- [ ] **Step 2: Correr.** `npm test` → FAIL (hay `dependencies`).
- [ ] **Step 3: Implementar.** `@clack/prompts` pasa a `devDependencies` (misma versión exacta `1.8.1`); agregar `@ramon-sg/runner` (exacta, la 1.0.x publicada) y `esbuild` (exacta, la última estable). `scripts/bundle.mjs`: esbuild de `src/cli.ts` a `dist/cli.js`, `bundle: true`, `platform: "node"`, `format: "esm"`, `target: "node20"`, banner `#!/usr/bin/env node`. `build`: `tsc --noEmit && node scripts/bundle.mjs`. `test`: `npm run build && node --test test/*.test.mjs`. `ownVersion()` en `src/cli.ts` lee `../package.json` relativo a `dist/cli.js`: comprobar que sigue funcionando empaquetado.
- [ ] **Step 4: Correr.** `npm test` → PASS (todos los tests existentes y el nuevo).
- [ ] **Step 5: CI con Bun.** En `.github/workflows/test.yml`, un segundo job igual al de Node más `oven-sh/setup-bun@v2`, que corre `npm ci`, `npm run build` y `bun dist/cli.js --version` (el CLI empaquetado arranca con Bun) y el suite con `node --test` teniendo `bun` en el PATH (lo usa la Task A4).
- [ ] **Step 6: Commit** (con OK). `build: agent-kitchen se publica con sus dependencias adentro`

### Task A2: Correr las herramientas con el ejecutor del repo

**Files:**
- Modify: `src/tools.ts`, todos los llamadores (`src/pr-clone.ts`, `src/skills-files.ts`, `src/pieces/{cloud,issue-flow,skills,guard}.ts`, `src/commands/sync.ts`), `test/fake-tools.mjs`, `test/helpers.mjs`
- Create: `test/runner-mode.test.mjs`

**Interfaces:**
- Consumes: `readRunnerConfig`, `effectiveRunner`, `toolCommand`, `toolCommandText` de `@ramon-sg/runner`.
- Produces (reemplazan a `runNpx`, `captureNpx`, `captureNpxWithout` con los mismos parámetros y retornos):
  - `type RepoMode = { kind: "runner"; runner: Runner } | { kind: "legacy" }` y `repoMode(root: string): RepoMode` en `src/tools.ts`.
  - `runTool(root: string, args: string[], env?: NodeJS.ProcessEnv): Promise<ToolRun>`
  - `captureTool(root: string, args: string[], lookup?: boolean, env?: NodeJS.ProcessEnv)`
  - `captureToolWithout(root: string, args: string[], unset: string[])`
  - `toolText(root: string, args: string[]): string` — el comando para mostrar en un mensaje de "córrelo a mano".
  - `download(root: string, spec: string)` — misma firma; en modo runner con Bun no hace nada (el spike mostró que Bun no puede precargar sin correr la herramienta); con Node, igual que hoy.
  - `args[0]` sigue siendo el spec (`paquete@versión` o `github:…#vX`); se separa en paquete y versión por el último `@` que no está en la posición 0. Un spec `github:` en modo runner es un error de programación (lanzar).

- [ ] **Step 1: Herramientas falsas.** `helpers.mjs` crea también `bunx` (`FAKE_AS=bunx`); `fake-tools.mjs`, para `bunx`, quita un `--bun` inicial y sigue como `npx`. `calls()`/`allCalls()` devuelven las llamadas de `npx` y de `bunx` sin su primer argumento (`--yes` / `--bun`); agregar `programs()` que devuelve qué programa hizo cada llamada.
- [ ] **Step 2: Tests que fallan** (`test/runner-mode.test.mjs`):
  - `installedRepo()` sin `runner.json`, `apply --yes`: `programs()` solo tiene `npx` (modo viejo intacto).
  - Mismo repo con `.agents/runner.json` `{"runner":"node","tools":{…las versiones de installedRepo…}}`: solo `npx`.
  - Con `{"tools":{…}}` (sin `runner`): solo `bunx`, y cada llamada empieza por el spec con versión exacta.
  - Un paso que falla en modo runner con Bun muestra el comando a mano con `bunx --bun …`.
- [ ] **Step 3: Correr** → FAIL.
- [ ] **Step 4: Implementar** en `src/tools.ts` y cambiar los llamadores de `npx ${spec}` en los mensajes por `toolText(root, …)`. En esta task las versiones se siguen leyendo de donde hoy (la Parte B las mueve).
- [ ] **Step 5: Correr.** `npm test` → PASS, incluidos todos los tests anteriores sin tocarlos más que en los helpers.
- [ ] **Step 6: Commit** (con OK). `feat: las herramientas corren con el ejecutor de runner.json`

### Task A3: Consultar npm sin `npm`

**Files:**
- Modify: `src/tools.ts` (`npmVersion`, `npmDependencies`), `test/helpers.mjs`
- Create: `test/fake-registry.mjs`

**Interfaces:**
- Produces: misma firma de `npmLatest`, `npmLatestExact`, `npmDependencies`. Leen `GET <registro>/<paquete codificado>` y usan `dist-tags.latest` y `versions[<v>].dependencies`. `<registro>` sale de `AGENT_KITCHEN_REGISTRY`, por defecto `https://registry.npmjs.org`. Mismo límite de 20 s y el mismo `null` si falla.

- [ ] **Step 1: Registro falso.** `test/fake-registry.mjs` es un proceso hijo (puerto 0, imprime el puerto) que `helpers.mjs` arranca una vez por archivo de test. Cada `cli()` escribe `FAKE_NPM` y `FAKE_NPM_DEPS` en un JSON del `tmp` del repo y pasa `AGENT_KITCHEN_REGISTRY=http://127.0.0.1:<puerto>/<id del repo>`; el servidor responde desde ese JSON (404 si el paquete no está). El `npm view` falso queda solo para los tests que lo verifican ausente.
- [ ] **Step 2: Test que falla.** Con el PATH sin `npm` (un `npm` falso que sale 127), `apply --dry-run` sobre `installedRepo()` muestra las mismas versiones "última" que con npm; y `npmCalls()` está vacío.
- [ ] **Step 3: Correr** → FAIL. **Step 4: Implementar** con `fetch` y `AbortSignal.timeout(LOOKUP_TIMEOUT_MS)`. **Step 5: Correr** → PASS (todo el suite).
- [ ] **Step 6: Commit** (con OK). `feat: las versiones de npm se leen del registro, sin npm`

### Task A4: Relanzar la versión nueva con el mismo ejecutor

**Files:**
- Modify: `src/cli.ts` (`handOver`), `test/cli.test.mjs`

**Interfaces:**
- Produces: `handOver` usa `toolCommand(process.versions.bun !== undefined ? "bun" : "node", "agent-kitchen", latest, argv)`.

- [ ] **Step 1: Test que falla.** Con el registro falso diciendo que `agent-kitchen` tiene una versión mayor: el CLI corrido con `node dist/cli.js` relanza por `npx --yes agent-kitchen@<versión>`; corrido con el `bun` real (`bun dist/cli.js`), por `bunx --bun agent-kitchen@<versión>`. Sin `bun` en la máquina, ese caso se marca `skip` con el motivo; en CI corre (Task A1, Step 5). Sin variables de prueba en el código.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4: Correr** → PASS.
- [ ] **Step 5: Commit** (con OK). `feat: agent-kitchen se relanza con el ejecutor con que se lo llamó`

### Task A5: `doctor` revisa `runner.json`

**Files:**
- Modify: `src/commands/doctor.ts`, `src/commands/sync.ts` (lectura al inicio), `test/doctor.test.mjs`

**Interfaces:**
- Consumes: `checkRunner`, `RunnerFileError` de `@ramon-sg/runner`.

- [ ] **Step 1: Tests que fallan:**
  - Repo con `runner.json` válido y `bunx` falso en el PATH → una línea `runner` con `✓`.
  - Sin `bunx` en el PATH → `✗` y `doctor` sale con 1.
  - Repo sin `runner.json` → ninguna línea `runner` (modo viejo: nada que revisar todavía).
  - **`runner.json` con `"runner":"deno"` → `doctor` y `apply` salen con 1 y el bloque de error nombra `.agents/runner.json`; ninguna traza en stderr.** (Review Focus 3)
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar:** `RunnerFileError` se convierte en `KitError` en un solo lugar de lectura. **Step 4: Correr** → PASS.
- [ ] **Step 5: Commit** (con OK). `feat: doctor revisa runner.json y su ejecutor`

### Task A6: `AGENTS.md` y el install solo con dependencias propias

**Files:**
- Modify: `src/pieces/agents-md.ts`, `src/commands/sync.ts` (`install`), `src/repo.ts`, `test/agents-md.test.mjs`, `test/sync.test.mjs`

**Interfaces:**
- Produces: `ownDependencies(root: string): string[]` en `src/repo.ts` — los nombres de `dependencies` y `devDependencies` de `package.json` que no son herramientas del ecosistema (`@ramon-sg/issue-flow`, `@ramon-sg/github-rest`, `@ramon-sg/skills-manager`, `@ramon-sg/claude-repo-guard`, `agent-cloud-kit`).

- [ ] **Step 1: Tests que fallan:**
  - `package.json` con solo `scripts` → la pieza `agents-md` no aparece y `AGENTS.md` no se escribe.
  - `package.json` con solo herramientas del ecosistema en `devDependencies` → tampoco.
  - Con `"dependencies":{"react":"19.0.0"}` → se ofrece y se escribe, como hoy.
  - `apply` que cambia un `package.json` sin dependencias propias → no corre install (ninguna llamada `npm install`/`pnpm install`).
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4: Correr** → PASS (los tests existentes de `agents-md` con `package.json` de solo herramientas cambian su expectativa: anotarlo en el mensaje del commit).
- [ ] **Step 5: Commit** (con OK). `feat: AGENTS.md e install solo si el repo tiene dependencias propias`

---

## Parte B — necesita las versiones de las herramientas que leen `runner.json`

**Antes de empezar:** están publicadas las versiones de los pasos 3–6 de la spec (2026-11-21): `@ramon-sg/issue-flow` 0.6.0, `@ramon-sg/skills-manager` 1.5.0 (última 1.5.1, solo arreglos), `@ramon-sg/claude-repo-guard` 0.8.0 (primera en npm; mismo commit que el tag `v0.8.0`), `agent-cloud-kit` 1.0.0, `@ramon-sg/github-rest` 0.7.0.

**Cómo se comportan esas versiones** (leído de su código; hay que respetarlo):
- **`issue-flow` ≥ 0.6.0 no tiene modo viejo.** `apply --yes --json` en cualquier repo crea o actualiza `runner.json` (su entrada, y `github-rest` si falta, sin subirla nunca si ya está), reescribe sus 3 hooks y los atajos `issue:start`, `issue:start:free`, `worktree:prune`, `pr:worktree`, quita `@ramon-sg/issue-flow` y `@ramon-sg/github-rest` de `dependencies`/`devDependencies` y los scripts viejos `issue-flow …`, y quita el hook `SessionStart` propio de `agent-cloud-kit`. No corre install ni borra `node_modules` ni lockfiles (solo sugiere `<pm> install`). `issue-flow --version --json` → `{version, githubRest, runner}`; el piso de `github-rest` es 0.6.0. Se niega si `package.json`, un hook o `runner.json` tienen una `issue-flow` más nueva o un rango.
- **`claude-repo-guard` 0.8.0** sigue en modo viejo si el repo tiene el manifest y no tiene `runner.json`: hay que crear `runner.json` antes. `apply --yes` en modo runner escribe su entrada, los atajos `claude:auto`/`claude:free`, sandbox y doc; deja y reescribe `.claude/repo-guard.manifest.json` (no borrarlo: lo usa `uninstall`). No escribe hooks de Claude Code. Nunca correr su `apply` desde dentro de una sesión de Claude Code ya instalada (el sandbox bloquea `.claude/settings.json`).
- **`skills-manager` 1.5.x** solo agrega o sube su propia entrada en `runner.json`, y solo si hay manifiesto. No toca `package.json` ni el hook `SessionStart` de `session-notice`. No tiene `--version`.
- **`agent-cloud-kit` 1.0.0** lee su versión de `runner.json` y, si no está, de `version` en `.claude/cloud.json` (con aviso). `init` crea `runner.json` también en un repo viejo, sembrado con la versión de `cloud.json`; nunca borra esa clave (su `doctor` avisa que sobra). En la nube, con `bun` y sin `bunx`, corre `npm install -g bun`.
- **`github-rest` 0.7.0** no lee `runner.json`.
- Sin terminal: `--yes` para `issue-flow` (`apply --yes --json`) y el guard (`apply --yes`); `skills-manager` y `agent-cloud-kit` no lo necesitan.

**Consecuencia: la migración es todo o nada también hacia afuera.** En modo viejo, `agent-kitchen` no puede ofrecer actualizar una herramienta a una versión ≥ su mínimo (Task B1): eso la migraría sola. Esa subida solo ocurre dentro del paso de migración (Task B3).

### Task B1: Versiones mínimas y versiones desde `runner.json`

**Files:**
- Create: `src/runner-mode.ts`, `test/runner-versions.test.mjs`
- Modify: `src/pieces/{issue-flow,skills-manager,cloud,guard}.ts`, `src/skills-files.ts` (`skillsManagerSpec`), `src/cli.ts` (`startLookups`), `test/fake-tools.mjs`

**Interfaces:**
- Produces en `src/runner-mode.ts`:
  - `RUNNER_MINIMUMS: Record<string, string>` — paquete → primera versión que lee `runner.json`: `@ramon-sg/issue-flow`, `@ramon-sg/skills-manager`, `@ramon-sg/claude-repo-guard`, `agent-cloud-kit`. Los valores son los anotados en "Antes de empezar".
  - `GUARD_PACKAGE = "@ramon-sg/claude-repo-guard"`.
  - `toolVersion(root: string, pkg: string): string | null` — en modo runner, la de `runner.json`; en modo viejo, de donde hoy (`package.json`, `.claude/cloud.json`, manifest del guard).
  - `legacyCeiling(pkg: string): string` — en modo viejo, la versión ofrecida para actualizar es la más nueva **por debajo** de `RUNNER_MINIMUMS[pkg]` (de `versions` del registro; para el guard, el tag más nuevo bajo `v0.8.0`). Si no hay ninguna más nueva que la instalada, no hay paso de actualización. Una instalación nueva en modo viejo no existe: un repo sin herramientas nace en modo runner (Task B2).
- En modo runner:
  - La pieza `claude-repo-guard` corre `@ramon-sg/claude-repo-guard@<v> apply --yes` y busca la última con `npmLatest(GUARD_PACKAGE)` en vez de `latestTag`. Se quita el arreglo temporal de la Parte A que corría specs `github:` con `npx` en modo runner (en modo runner ya no hay specs `github:`).
  - `agent-kitchen` escribe y vuelve a fijar el hook `SessionStart` de `session-notice` con el comando del ejecutor y la versión de `skills-manager`, en cada instalación o actualización de `skills-manager`.
  - Después de correr `issue-flow`, si la entrada de `@ramon-sg/github-rest` en `runner.json` está bajo la `githubRest` de `issue-flow --version --json` o bajo la última de npm, `agent-kitchen` la sube con `setTool` (nunca la baja).
  - `splitSpec` rechaza un spec sin versión exacta (`isExactVersion`).
  - Las sugerencias "córrelo a mano" que todavía dicen `npx` (`src/pr-clone.ts` `prCommand`, `src/commands/sync.ts` `cloudNext`) usan `toolText` con la versión de `runner.json`.

- [ ] **Step 1: `fake-tools.mjs`.** Las versiones falsas desde los mínimos escriben su entrada en `.agents/runner.json` (con `setTool`/`writeRunnerConfig` reales importados de `node_modules/@ramon-sg/runner`) en vez de `devDependencies` / `cloud.json` / manifest, y sus hooks y atajos con el comando de su ejecutor.
- [ ] **Step 2: Tests que fallan:**
  - En un repo en modo runner con las versiones de los mínimos, `apply --dry-run` muestra la versión de cada pieza leída de `runner.json` (y no la de un `package.json` con otros números puesto a propósito); `apply --yes` actualiza cada una corriendo su spec con `bunx --bun`; el guard se busca en el registro, no con `git ls-remote`.
  - **Modo viejo con `issue-flow` 0.5.1 instalado y el registro diciendo `0.5.2` y `0.6.0`: el paso ofrecido es a `0.5.2`; con solo `0.6.0` más nueva, no hay paso de actualización de `issue-flow`.** Igual para el guard con tags `v0.7.1` y `v0.8.0`.
  - Modo runner: tras actualizar `skills-manager`, el hook `SessionStart` de `session-notice` dice `bunx --bun @ramon-sg/skills-manager@<nueva> session-notice`.
  - Modo runner: `issue-flow` falso que deja `github-rest` en 0.6.0 y registro con 0.7.0 → `runner.json` termina con 0.7.0.
- [ ] **Step 3: Correr** → FAIL. **Step 4: Implementar.** **Step 5: Correr** → PASS.
- [ ] **Step 6: Commit** (con OK). `feat: en modo runner las versiones salen de runner.json`

### Task B2: Un repo nuevo nace en modo runner

**Files:**
- Modify: `src/commands/sync.ts`, `src/menu.ts`, `src/texts/{es,en}.ts`, `test/sync.test.mjs`

**Interfaces:**
- Consumes: `chooseRunner`, `writeRunnerConfig` de `@ramon-sg/runner`.
- Produces: antes de correr pasos, si no hay `runner.json` y el repo no tiene ninguna herramienta instalada, `sync` escribe `runner.json` con el `runner` elegido y sin `tools` (cada herramienta agrega la suya). En terminal sin Bun, la pregunta "¿usar Node o salir?" va con las demás preguntas, antes de instalar; `--yes` o sin terminal: `node` con el aviso de `chooseRunner`. `--dry-run` no escribe nada.

- [ ] **Step 1: Tests que fallan:** repo vacío, `bunx` en el PATH, `apply --yes` → `.agents/runner.json` con `"runner":"bun"` escrito (explícito, para que el archivo diga lo que se eligió), y todas las llamadas por `bunx`; sin `bunx` y sin terminal → `"runner":"node"`, el aviso en la salida y las llamadas por `npx`; `--dry-run` → no existe `runner.json`.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4: Correr** → PASS.
- [ ] **Step 5: Commit** (con OK). `feat: un repo nuevo nace con runner.json`

### Task B3: Migrar un repo del modo viejo

**Files:**
- Create: `src/pieces/runner.ts`, `test/migrate.test.mjs`
- Modify: `src/commands/sync.ts` (`PIECES`: `runner` primero), `src/decisions.ts` (no es decidible: no entra en `DECIDABLE`), `src/texts/{es,en}.ts`

**Interfaces:**
- Produces: pieza `runner` con `status(root)` y `checks(root)` (contrato de `src/piece.ts`). Se ofrece en modo viejo cuando hay al menos una herramienta instalada y la última versión en npm de cada herramienta instalada está en o sobre su mínimo. Su paso, `checked: true`, hace en este orden (las herramientas van a su última versión, no a la instalada):
  1. Escribir `runner.json` con `"runner"` según `chooseRunner` (o `--runner`, Task B4) y las entradas de las herramientas instaladas en su versión destino. Antes que cualquier herramienta: el guard sigue en modo viejo sin este archivo.
  2. `issue-flow apply --yes --json` (si está instalada). Luego subir `github-rest` como en B1.
  3. `claude-repo-guard apply --yes` (si está instalado; desde `@ramon-sg/claude-repo-guard`, ya no desde GitHub). El manifest se queda.
  4. `agent-cloud-kit init` (si está instalado), y quitar la clave `version` de `.claude/cloud.json` (el archivo se queda).
  5. `skills-manager` en su versión destino (su paso de update), el hook de `session-notice` como en B1, y quitar `@ramon-sg/skills-manager` de `devDependencies` y cualquier script `npx skills-manager …`.
  6. Si quedan dependencias propias (`ownDependencies`), install con el gestor del lockfile; si no, borrar `node_modules` y el lockfile. El `package.json` se queda (tiene los atajos).
  Si un paso falla, los siguientes no corren y el resumen lo dice; no se intenta deshacer.

- [ ] **Step 1: Tests que fallan:**
  - `installedRepo()` con todas las herramientas en o sobre `RUNNER_MINIMUMS` → se ofrece el paso; tras `apply --yes`: `runner.json` tiene las cinco versiones, `package.json` no tiene `devDependencies` del ecosistema, `cloud.json` no tiene `version`, y no existen `package-lock.json` ni `node_modules`.
  - **Igual pero con `"dependencies":{"react":"19.0.0"}` y `pnpm-lock.yaml` → corre `pnpm install`, `react` sigue en `package.json` y el lockfile existe.** (Review Focus 4)
  - **Con el registro sin ninguna `skills-manager` en o sobre su mínimo → no hay paso `runner`, la tabla nombra `@ramon-sg/skills-manager` y su mínimo, y nada cambia.** (Review Focus 5)
  - El orden de las llamadas es: `runner.json` escrito antes de la primera llamada; luego `issue-flow`, guard, `agent-cloud-kit`, `skills-manager` (con `programs()`/`allCalls()`), y `.claude/cloud.json` queda sin `version` pero existe; el manifest del guard sigue.
  - Un paso de herramienta que falla → los siguientes no corren y la salida lo dice.
  - `--pr`: el commit lleva `runner.json`, `package.json` y el lockfile borrado o actualizado.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4: Correr** → PASS.
- [ ] **Step 5: Commit** (con OK). `feat: migrar un repo a runner.json`

### Task B4: `--runner node|bun`

**Files:**
- Modify: `src/cli.ts` (opción y uso), `src/commands/sync.ts`, `src/texts/{es,en}.ts`, `test/cli.test.mjs`, `test/runner-mode.test.mjs`

**Interfaces:**
- Produces: `--runner <bun|node>` en `apply`: en modo runner, escribe `runner` y corre el `apply` de cada herramienta instalada en su versión, para que reescriba hooks y atajos; en modo viejo, migra (Task B3) con ese ejecutor. Otro valor → `UsageError`. `doctor` no lo acepta.
  - Si el repo no tiene dependencias propias (`ownDependencies(root)` falso), `--runner` también ajusta `packageManager` del `package.json` de los atajos: `bun` → `bun@<salida de bun --version>`; `node` → se quita el campo. Con dependencias propias, `packageManager` es del repo y no se toca.

- [ ] **Step 1: Tests que fallan:** `--runner node` en un repo `bun` → `runner.json` dice `node` y las llamadas a los `apply` son por `npx`; `--runner deno` → sale 2 con el uso; `doctor --runner node` → sale 2; un repo sin dependencias propias con `"packageManager": "bun@1.3.0"` y `--runner node` → el campo ya no está; con dependencias propias → sigue igual.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4: Correr** → PASS.
- [ ] **Step 5: Commit** (con OK). `feat: apply --runner cambia el ejecutor de un repo`

### Task B5: Documentación

**Files:**
- Modify: `README.md`, `README.en.md`, `docs/README.md`, `docs/agent-guide.md`

- [ ] **Step 1:** Mapa de archivos y tabla "Versiones: quién fija qué" de `docs/agent-guide.md` con `.agents/runner.json`; reglas 2 y 3 sin `npx` fijo ("con el ejecutor de `.agents/runner.json`"); `README*`: piezas, uso (`--runner`, `bunx agent-kitchen apply`), migración y "sin `node_modules`".
- [ ] **Step 2:** `npm test` → PASS (`test/texts.test.mjs` y el resto).
- [ ] **Step 3: Commit** (con OK). `docs: runner.json, Bun por defecto y la migración`
