# Diseño: las herramientas corren con `bunx`, sin `node_modules` y sin `npx` fijo

## En simple

Hoy cada herramienta del ecosistema (`issue-flow`, `github-rest`, `skills-manager`, `agent-cloud-kit`, `claude-repo-guard`) se corre con `npx`, escrito a mano en hooks, skills y código. Las versiones viven en `package.json`, y un repo que no es de Node (Crystal, por ejemplo) termina con `package.json`, lockfile y `node_modules` solo para eso.

Con este cambio, el repo dice en un archivo qué ejecutor usa y qué versión exacta de cada herramienta. Por defecto es Bun: los hooks, las skills y `agent-kitchen` corren `bunx --bun <paquete>@<versión>`. Si el repo pide Node, corren `npx --yes <paquete>@<versión>`. Nada se instala en el repo: ni `node_modules` ni lockfile. Los atajos (`bun run issue:start 42`) siguen existiendo en un `package.json` que solo tiene `scripts`.

## Por qué

- Un repo que no es de Node no debería cargar `node_modules`, un lockfile y un paso de install para tener el flujo de issues.
- `npx` escrito a mano ata todo a Node y a npm. El usuario prefiere Bun por defecto y poder elegir Node.
- Sin `package.json`, las skills que dicen `npx @ramon-sg/github-rest` corren la última versión de npm, no la del repo. Es un bug silencioso de hoy.
- Se descartó atarse a un gestor de herramientas de terceros (mise): puede desaparecer o cambiar, y es otra dependencia en cada máquina y en la nube.
- Se descartó reescribir las herramientas en otro lenguaje o compilarlas a binarios: npm ya resuelve distribuir para todas las plataformas y fijar la versión por repo; un binario de `bun build --compile` pesa decenas de MB, y la nube de Claude bloquea las releases de GitHub.

## Objetivos

1. Un archivo del repo, commiteado, dice el ejecutor (`bun` o `node`) y la versión exacta de cada herramienta.
2. Sin ejecutor escrito, el ejecutor es `bun`.
3. Hooks, skills y `agent-kitchen` corren las herramientas con el ejecutor y la versión de ese archivo. Ningún texto ni código del ecosistema dice `npx` fijo.
4. Ninguna herramienta del ecosistema se instala en el repo: sin `devDependencies`, sin lockfile, sin `node_modules` por su causa.
5. Los atajos (`issue:start`, `issue:start:free`, `worktree:prune`, `pr:worktree`, `claude:auto`, `claude:free`) existen como `scripts` de un `package.json` sin dependencias.
6. Funciona igual si una herramienta se instala sola, sin `agent-kitchen`.
7. Los repos que ya tienen las herramientas en `devDependencies` pasan al nuevo modo con `agent-kitchen apply`.

## Fuera de alcance

- Reescribir las herramientas en otro lenguaje o publicar binarios.
- Soportar pnpm, yarn o Deno como ejecutor. Solo `bun` y `node`.
- Cambiar las dependencias propias de un repo de Node: si el repo tiene `node_modules` por su código, se queda; solo salen las herramientas del ecosistema.
- Fijar la versión de Bun o de Node: eso es del repo (`.tool-versions`, `packageManager`) y de la máquina.

## Lo que no debe pasar (anti-objetivos)

- Que una skill o un hook corra una versión distinta de la que dice el archivo del repo.
- Que una máquina con Node y Bun corra las herramientas con Node cuando el repo dice `bun` (ver `--bun` abajo).
- Que una herramienta instalada sola, sin `agent-kitchen`, quede sin saber cómo correr las demás.
- Que la versión de una herramienta se escriba en dos lugares que puedan quedar distintos sin que `doctor` lo vea.
- Que un repo de Node pierda sus propias dependencias o su lockfile en la migración.

## Enfoques considerados

| Enfoque | Qué cambia | Por qué no (o sí) |
|---|---|---|
| **A. Lanzador de shell versionado en el repo** (`.agents/bin/run`, patrón `gradlew`) | Skills y hooks llaman al script; el script decide | Si una herramienta se instala sin `agent-kitchen`, nadie escribe el lanzador; cinco herramientas tendrían que mantener la misma copia |
| **B. `ni` / `nlx` global** | Skills y hooks dicen `nlx` | Otra instalación global en cada máquina y en la nube; su bin es de Node |
| **C. mise** (`npm:` en `mise.toml`, tareas) | Las herramientas quedan en el PATH con la versión del repo | Atarse a un tercero; correr las herramientas sigue pidiendo Node |
| **D. Herramientas copiadas en el repo** (patrón `yarnPath`) | Un `.cjs` por herramienta en `.agents/tools/` | Archivos generados en git, diffs ilegibles, y vuelve a necesitar el lanzador de A |
| **E. Binarios compilados** | Sin runtime | Decenas de MB por binario, cuatro plataformas, releases de GitHub bloqueadas en la nube |
| **F. Ejecutor y versiones en un archivo; cada herramienta escribe `bunx`/`npx` con `@versión` donde le toca** | Elegido | Sin archivos ni instalaciones nuevas; funciona sin `agent-kitchen` porque cada herramienta lee el mismo archivo |

El usuario eligió **F**, con Bun por defecto y sin `node_modules`. También eligió: el nombre `.agents/runner.json`; publicar cada herramienta con sus dependencias adentro; y el paquete compartido `@ramon-sg/runner`, en un repo propio. "Un solo modo para todos los repos (también los de Node)" es decisión del diseño, no del usuario: se sigue de "sin `node_modules`" y evita mantener dos caminos.

## El archivo: `.agents/runner.json`

Decisión de diseño: un archivo propio y neutral, no `.agents/kitchen.json`. `kitchen.json` es de `agent-kitchen`; este lo leen todas las herramientas, también instaladas solas.

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/@ramon-sg/runner@1.0.0/runner.schema.json",
  "runner": "bun",
  "tools": {
    "@ramon-sg/issue-flow": "0.6.0",
    "@ramon-sg/github-rest": "0.7.0",
    "@ramon-sg/skills-manager": "1.5.0",
    "agent-cloud-kit": "1.0.0",
    "@ramon-sg/claude-repo-guard": "0.8.0"
  }
}
```

- `runner`: `"bun"` o `"node"`. Si falta, `"bun"`.
- `tools`: nombre del paquete en npm → versión exacta (`X.Y.Z` o prerelease). Nunca un rango.
- Cada herramienta escribe y mueve **solo su propia entrada** (y las de las herramientas que necesita, si faltan, sin bajarlas nunca). Así `issue-flow apply` agrega `@ramon-sg/github-rest` si no está, igual que hoy lo agrega a `package.json`.
- Se commitea. Se puede editar a mano.

### Cómo se corre una herramienta

| `runner` | Comando |
|---|---|
| `bun` | `bunx --bun <paquete>@<versión> <args>` |
| `node` | `npx --yes <paquete>@<versión> <args>` |

`--bun` es obligatorio: los bins de las herramientas empiezan con `#!/usr/bin/env node`, y sin `--bun` Bun usa Node si está instalado. **Por verificar en la etapa 0.**

### Quién escribe qué

| Lugar | Hoy | Con este diseño |
|---|---|---|
| Versión de `issue-flow`, `github-rest`, `skills-manager` | `devDependencies` de `package.json` | `tools` de `.agents/runner.json` |
| Versión de `agent-cloud-kit` | `.claude/cloud.json` | Solo `runner.json` (decisión del usuario). `agent-cloud-kit` la lee de ahí al arrancar en la nube; la migración la saca de `.claude/cloud.json` |
| Versión de `claude-repo-guard` | `.claude/repo-guard.manifest.json`, corre con `npx github:ramon-sg/claude-repo-guard#vX.Y.Z` | Publicado en npm como `@ramon-sg/claude-repo-guard`; versión en `runner.json` |
| Hooks en `.claude/settings.json` | `npx --yes @ramon-sg/issue-flow@X hook …` | El comando de la tabla de arriba, según `runner` |
| Skills (texto) | `npx @ramon-sg/github-rest …` | "Corre `@ramon-sg/github-rest` con el ejecutor y la versión de `.agents/runner.json`", con el comando de cada `runner` |
| Atajos en `package.json` | `"issue:start": "issue-flow issue start"` (bin local) | `"issue:start": "bunx --bun @ramon-sg/issue-flow@0.6.0 issue start"`; los reescribe la herramienta dueña cuando cambia su versión |

Los atajos repiten la versión. Es la única duplicación aceptada: la escribe la misma herramienta que escribe su entrada en `runner.json`, y `doctor` de esa herramienta revisa que coincidan.

### El `package.json` de los atajos

```json
{
  "private": true,
  "packageManager": "bun@1.3.0",
  "scripts": {
    "issue:start": "bunx --bun @ramon-sg/issue-flow@0.6.0 issue start",
    "issue:start:free": "bunx --bun @ramon-sg/issue-flow@0.6.0 issue start --free",
    "worktree:prune": "bunx --bun @ramon-sg/issue-flow@0.6.0 worktree prune",
    "pr:worktree": "bunx --bun @ramon-sg/issue-flow@0.6.0 pr worktree",
    "claude:auto": "claude --settings .claude/repo-guard.auto-mode.json --permission-mode auto",
    "claude:free": "claude --settings '{\"sandbox\":{\"enabled\":false}}' --dangerously-skip-permissions"
  }
}
```

- Sin `dependencies` ni `devDependencies` de las herramientas: `bun run` y `npm run` no necesitan install para correr un script.
- `packageManager` lo escribe quien crea el archivo según `runner` (`bun@<versión instalada>` o `npm@<versión instalada>`), para que `issue-flow` y `claude-repo-guard` muestren `bun run …` o `npm run …`.
- `claude:auto` y `claude:free` los escribe `claude-repo-guard`, también cuando el `package.json` se crea en la misma corrida de `agent-kitchen`.
- Si el repo ya tiene `package.json` (un repo de Node), solo se tocan esos scripts y se quitan las herramientas de `devDependencies`.

## Herramientas instaladas solas

Cada herramienta, al hacer `apply`/`init`:

1. Lee `.agents/runner.json`. Si no existe, lo crea con `runner` según la regla de abajo y su propia entrada.
2. Escribe sus hooks, sus atajos y su entrada con ese `runner`.
3. No toca las entradas de las demás, salvo agregar las que necesita y faltan.

Regla del `runner` en un archivo nuevo: `bun` si `bun` está en el PATH; si no, y hay terminal, pregunta "Bun no está instalado: ¿usar Node o salir para instalar Bun?"; sin terminal, `node` con un aviso.

## El paquete `@ramon-sg/runner`

Todo lo que sabe de `.agents/runner.json` vive en una biblioteca propia, en el repo `ramon-sg/runner`. Sin CLI. Descripción en npm y primera línea del README: "Lee `.agents/runner.json` y arma el comando para correr cada herramienta con Bun o Node" (para que no se lea como algo que corre agentes de IA).

Hace:

- Leer, validar y crear `.agents/runner.json`. Publica `runner.schema.json`.
- Decidir el `runner` de un archivo nuevo (la regla de arriba).
- Armar el comando de una herramienta: `bunx --bun <paquete>@<versión>` o `npx --yes <paquete>@<versión>`, como texto (para hooks, atajos y mensajes) y como `[ejecutable, args]` (para `spawn`).
- Escribir o mover la entrada de una herramienta sin tocar las demás; agregar una que falta sin bajar nunca una existente.
- Escribir los atajos de una herramienta en `package.json`, creando el archivo si falta, con `packageManager` según `runner`.
- Revisiones para `doctor`: el ejecutor está instalado; `runner.json` es válido; los hooks y atajos de una herramienta dicen la misma versión que su entrada.

La usan `issue-flow`, `skills-manager`, `claude-repo-guard`, `agent-cloud-kit` y `agent-kitchen`. `github-rest` no: no corre otras herramientas ni escribe hooks.

Siempre se nombra con el scope: `runner` sin scope en npm es de otra persona.

### API pública (1.0)

Fija para que todas las herramientas programen contra lo mismo. TypeScript, ESM, sin dependencias en tiempo de ejecución, solo APIs `node:*` que Bun también tiene.

```ts
export type Runner = "bun" | "node";

/** Ruta del archivo, relativa a la raíz del repo. */
export const RUNNER_FILE = ".agents/runner.json";

/** Lo leído. `extra` guarda las claves desconocidas para escribirlas de vuelta. */
export interface RunnerConfig {
  runner: Runner | null;            // null si el archivo no lo dice
  tools: Record<string, string>;    // paquete → versión exacta
  extra: Record<string, unknown>;
}

/** Error de un archivo inválido: JSON roto, runner desconocido, versión que no es exacta. */
export class RunnerFileError extends Error { file: string }

/** Lee el archivo; null si no existe. Lanza RunnerFileError si es inválido. */
export function readRunnerConfig(root: string): RunnerConfig | null;

/** Escribe el archivo con $schema, las claves de extra y tools ordenado por nombre. */
export function writeRunnerConfig(root: string, config: RunnerConfig): void;

/** El runner efectivo: el del archivo, o "bun". */
export function effectiveRunner(config: RunnerConfig | null): Runner;

/** Si el ejecutor está en el PATH (`bunx` o `npx`). */
export function runnerAvailable(runner: Runner): boolean;

/**
 * El runner para un archivo nuevo: "bun" si está; si no, pregunta con `ask` (si se da)
 * y, sin `ask`, "node" con un aviso. null si quien pregunta eligió salir.
 */
export function chooseRunner(options: { ask?: () => Promise<Runner | null> }): Promise<{ runner: Runner; warning: string | null } | null>;

/** Pone la versión de una herramienta. `ifMissing`: solo si no está. Nunca baja una existente salvo `allowLower`. */
export function setTool(config: RunnerConfig, pkg: string, version: string, options?: { ifMissing?: boolean; allowLower?: boolean }): { config: RunnerConfig; changed: boolean };

/** El comando para spawn: bun → ["bunx", ["--bun", "pkg@v", ...args]]; node → ["npx", ["--yes", "pkg@v", ...args]]. */
export function toolCommand(runner: Runner, pkg: string, version: string, args?: string[]): { file: string; args: string[] };

/** El mismo comando como texto de shell, con cada argumento entre comillas si hace falta. */
export function toolCommandText(runner: Runner, pkg: string, version: string, args?: string[]): string;

/**
 * Escribe los scripts de una herramienta en package.json: crea el archivo si falta
 * ({ private: true, packageManager }), reemplaza solo los nombres dados, y nunca toca otros
 * scripts ni dependencias. Devuelve los nombres que ya existían con otro contenido que no
 * es de la herramienta (`owned` dice qué prefijo de comando la identifica), sin pisarlos.
 */
export function writeScripts(root: string, runner: Runner, scripts: Record<string, string>, owned: string): { changed: boolean; clashes: string[] };

/** Revisiones para doctor. */
export interface Check { name: string; status: "ok" | "warn" | "fail"; detail: string }
export function checkRunner(root: string): Check[];                      // archivo válido, ejecutor instalado
export function checkToolPins(root: string, pkg: string, texts: string[]): Check[]; // que cada texto (hook, script) diga la versión de runner.json
```

El paquete exporta también `runner.schema.json` (`"exports": { "./schema": "./runner.schema.json" }`). El `$schema` del archivo apunta a la copia en jsDelivr de la versión que lo escribió (`https://cdn.jsdelivr.net/npm/@ramon-sg/runner@<versión>/runner.schema.json`).

Se descartó ponerla dentro de `agent-kitchen`: cada herramienta dependería de `agent-kitchen` (círculo, porque `agent-kitchen` las corre) y una instalada sola arrastraría todo `agent-kitchen`. Se descartó copiarla en cada herramienta: cinco copias se desalinean.

**Compatibilidad:** cada herramienta lleva dentro la versión de `@ramon-sg/runner` con que se publicó (ver la sección siguiente). Por eso el formato de `runner.json` es estable desde la 1.0: los cambios solo agregan campos opcionales; un campo desconocido se conserva al escribir y no hace fallar la lectura.

## Las herramientas se publican con sus dependencias adentro

Sin lockfile en el repo, `bunx <paquete>@<versión>` fija la herramienta pero no sus dependencias: esas se resuelven por rango cada vez que se bajan, en cada máquina y en cada sesión de la nube. Caso real hoy: `@ramon-sg/issue-flow` 0.5.1 en npm pide `@ramon-sg/github-rest` `^0.3.1`, mientras las skills corren la 0.6.0; y `@clack/prompts` 1.8.1 pide `sisteransi`, `fast-string-width` y `fast-wrap-ansi` con rango.

Decisión: cada herramienta, al publicar, junta su código y sus dependencias en su `dist/` con un bundler (esbuild o `bun build`, a elección de quien construye), y el paquete publicado queda **sin `dependencies`**. Las dependencias pasan a `devDependencies` del repo de la herramienta, con su lockfile, que es donde se prueban.

- Lo que corre es exactamente lo que se probó al publicar, con Bun o con Node.
- Una versión nueva de una dependencia de terceros no entra hasta que se publica otra versión de la herramienta.
- `issue-flow` declara qué `github-rest` lleva dentro (por ejemplo en `issue-flow --version --json`), y su `doctor` revisa que la entrada de `github-rest` en `runner.json` no sea más vieja: la misma regla que hoy aplica con el piso de su rango.
- Se descartó `npm-shrinkwrap.json`: npm lo respeta, pero no hay constancia de que Bun lo haga.

## `agent-kitchen`

- `src/tools.ts`: `runNpx`, `captureNpx`, `captureNpxWithout` y `download` pasan a `runTool`, `captureTool`, `captureToolWithout` y `download`, que leen `runner` del repo y arman `bunx --bun …` o `npx --yes …`. `download` con Bun: `bunx --bun --package` no existe igual; **por verificar en la etapa 0** cómo precargar la caché de Bun.
- `src/cli.ts`: el relanzamiento a la versión más nueva usa el ejecutor con el que se lo llamó (`process.versions.bun` dice si corre en Bun).
- Las versiones se leen de `runner.json`, no de `package.json`: `skillsManagerSpec`, la pieza `issue-flow`, la de `skills-manager` y el mínimo de `github-rest`.
- **Migración:** si no hay `runner.json` y el repo tiene herramientas instaladas al modo viejo, `apply` ofrece un paso "pasar las herramientas a `.agents/runner.json`". **Todo o nada:** se ofrece solo cuando la versión a la que va cada herramienta instalada ya lee `runner.json`; si alguna no, el paso no aparece y la tabla dice cuál falta. El paso:
  - copia las versiones exactas de `devDependencies` (`issue-flow`, `github-rest`, `skills-manager`), de `.claude/cloud.json` (`agent-cloud-kit`) y de `.claude/repo-guard.manifest.json` (`claude-repo-guard`, cuya versión de npm es el número de su tag);
  - quita esas entradas de `devDependencies` y la versión de `.claude/cloud.json`;
  - corre el `apply` de cada herramienta en su versión, que reescribe hooks y atajos con `runner`;
  - si el repo tiene dependencias propias, corre el install con el gestor de su lockfile para dejarlo al día; si no le quedan dependencias, borra `node_modules` del repo y el lockfile;
  - con `--pr`, el commit lleva el lockfile actualizado o borrado.
- Primera corrida en un repo sin `runner.json`: la regla del `runner` de arriba; en una terminal sin Bun, la pregunta va con las demás, antes de instalar.
- `--runner node|bun` en `apply` cambia el ejecutor de un repo y reescribe hooks y atajos de cada herramienta (corriendo su `apply`).
- `doctor`: revisa que el ejecutor esté instalado, que `runner.json` sea válido y que cada herramienta pase su propio doctor.
- Pieza `agents-md`: la regla de "mirar `node_modules`" solo se escribe si el repo tiene dependencias propias en `package.json`; en los demás no se escribe. La existencia de `package.json` deja de ser la condición.
- `--pr` y `install`: `apply` solo corre el install del gestor si el repo tiene dependencias propias que cambiaron. Un `package.json` de solo atajos no se instala.

## Orden entre repos

Cada herramienta es otro repo; desde una sesión de `agent-kitchen` solo se implementa `agent-kitchen`. Para los demás se abren issues con este documento enlazado.

0. **Verificación (spike, en cualquier máquina):** `bunx --bun` corre cada herramienta y sus tests pasan con Bun; `bunx --bun` respeta `--bun` con el shebang de Node; qué pasa sin red con la caché; cómo precargar la caché de Bun; un paquete publicado con sus dependencias adentro corre igual con `bunx` y `npx`; `bun` instalable en la nube de Claude (por npm: `npm i -g bun`, si las releases de GitHub están bloqueadas).
1. **`@ramon-sg/runner` (repo nuevo, lo crea el usuario):** la biblioteca, el esquema, CI con Node y Bun, publicada en npm. Antes que todo lo demás: el formato queda fijo aquí.
2. **`github-rest`:** se publica con sus dependencias adentro; CI con Node y Bun. Sin cambios de comportamiento.
3. **`issue-flow`:** usa `@ramon-sg/runner`; hooks y atajos según `runner`; deja de agregar `devDependencies`; skills sin `npx`; se publica con sus dependencias adentro (incluida `github-rest`); doctor revisa la coincidencia de versiones; CI con Node y Bun.
4. **`skills-manager`:** igual para su skill `manage-skills` y su entrada.
5. **`claude-repo-guard`:** se publica en npm como `@ramon-sg/claude-repo-guard`; usa `@ramon-sg/runner` para sus atajos, también si el `package.json` se crea en la misma corrida.
6. **`agent-cloud-kit`:** hook `SessionStart` y setup de la nube con `runner`; instala Bun en la nube si `runner` es `bun`.
7. **Catálogo `agent-skills`:** la única mención a `npx` pasa al texto neutral.
8. **`agent-kitchen`:** todo lo de la sección "`agent-kitchen`", usando `@ramon-sg/runner`, y publicado con sus dependencias adentro. Con mínimos de versión por herramienta: no ofrece el modo nuevo hasta que las versiones de 3–6 lo soporten.

El paso 8 puede empezar en cuanto exista la 1.0 de `@ramon-sg/runner`, en paralelo con 2–7, en lo que no depende de las demás (`src/tools.ts`, `--runner`, `doctor`, la migración).

**Si la etapa 0 sale mal:**
- Si `bunx --bun` no gana sobre `#!/usr/bin/env node`, el diseño se detiene: Bun por defecto no se puede garantizar y hay que volver a decidir con el usuario.
- Si no hay forma de precargar la caché de Bun, `agent-kitchen` no precarga con Bun: cada paso baja lo suyo al correr.
- Si Bun no se puede instalar en la nube, `agent-cloud-kit` falla con un mensaje que dice poner `"runner": "node"`, y el diseño sigue.

Hay dos planes: uno en el repo `ramon-sg/runner` (etapa 0 y paso 1) y uno en `agent-kitchen` (paso 8). Los pasos 2–7 quedan como issues en sus repos.

## Preguntas abiertas

Ninguna. Decisiones del diseño tras la revisión, que el usuario puede corregir: la API de `@ramon-sg/runner` arriba; la migración todo o nada; la versión de `claude-repo-guard` en npm igual al número de su tag; el install con el gestor del lockfile al migrar un repo con dependencias propias; qué pasa si la etapa 0 sale mal.

## Lo que queda a quien construye

- Nombres de funciones y módulos dentro de cada herramienta.
- Textos de los mensajes en español e inglés.
- Cómo se ve el paso de migración en la tabla de `apply`.
