# agent-kitchen

[English](README.en.md)

Un solo comando para instalar, actualizar y revisar lo que un repo usa para trabajar con agentes: el flujo de issues con sus skills, las skills generales, las sesiones de Claude en la nube y las barandas de seguridad.

```sh
bun x agent-kitchen apply   # muestra qué hay, qué falta y qué está atrasado, y pregunta
bun x agent-kitchen doctor  # revisa que todo funcione, sin cambiar nada
```

Con Node es `npx agent-kitchen apply`. Las herramientas corren con el ejecutor del repo (Bun por defecto) y las versiones exactas de `.agents/runner.json`, sin `node_modules` para ellas: ver [El ejecutor y `.agents/runner.json`](#el-ejecutor-y-agentsrunnerjson).

Qué hace cada herramienta y cada skill, y dónde están: [docs/README.md](docs/README.md) para personas y [docs/agent-guide.md](docs/agent-guide.md) para agentes.

Al arrancar revisa si npm tiene una versión más nueva de sí mismo. Si la hay, corre esa con los mismos argumentos y con el mismo ejecutor con el que se lo llamó (`bun x` si corre en Bun, `npx` si corre en Node), así que nunca usa una copia vieja de su caché.

## En simple

- Muestra cada pieza con la versión que tiene el repo y si está al día.
- Pregunta una vez: **todo lo sugerido** (Enter), **elegir** los pasos y las skills, o **salir**. Todas las preguntas van antes de instalar; después corre solo.
- Cada paso es una línea con ✓ o ✗. La salida de cada herramienta solo aparece si falla, o con `--verbose`.
- Es rápido: las versiones se consultan todas a la vez y las herramientas se descargan mientras respondes.
- Cada pieza la instala su propia herramienta. `agent-kitchen` solo sabe cuáles hay, en qué versión están y cómo se conectan entre sí. Las excepciones son una línea de `AGENTS.md` y, en un repo en modo viejo (sin `.agents/runner.json`), en `package.json` la versión de `skills-manager` y la de `github-rest` cuando queda bajo el mínimo de issue-flow, que escribe él mismo.
- Correrlo de nuevo no rompe nada: si todo está al día, lo dice y termina.

## Las piezas

| Pieza | Qué es | Versión del repo | Última | Instalar | Actualizar |
|---|---|---|---|---|---|
| `runner` | El paso de un repo en modo viejo a `.agents/runner.json` (ver [más abajo](#migración-de-un-repo-en-modo-viejo)). En un repo ya migrado muestra el ejecutor y, si una migración quedó a medias, ofrece terminarla. Con `--runner`, cambia el ejecutor | `.agents/runner.json` | — | Lo crea `agent-kitchen`: en un repo nuevo al empezar, en uno viejo con la migración | Migración, terminar la migración o `--runner` |
| `skills-manager` | La versión de [`@ramon-sg/skills-manager`](https://github.com/ramon-sg/skills-manager) que corre `agent-kitchen`: como mínimo 1.2.0. Si falta la agrega y si es menor la sube; nunca la baja. Un rango o `workspace:` no se toca, y avisa si la versión que corre queda bajo el mínimo. Solo en repos que usan skills y tienen `package.json`, o donde issue-flow se instala en la misma corrida: entonces crea el `package.json`. En modo runner no toca `package.json`: la versión va en `.agents/runner.json` | `.agents/runner.json` (modo viejo: `package.json`) | — | La agrega `agent-kitchen` | La sube `agent-kitchen` |
| `issue-flow` | Flujo de issues ([`@ramon-sg/issue-flow`](https://github.com/ramon-sg/issue-flow)): rama, worktree y PR en draft por issue, y sus 5 skills | `.agents/runner.json` (modo viejo: `package.json`) | npm | `issue-flow apply` (`init` antes de 0.3.0), y sus skills a la misma tag | `issue-flow apply` en la versión nueva (`upgrade` antes de 0.3.0), y sus skills a la misma tag. Desde 0.3.0, si su doctor ve hooks o el `$schema` atrás, `apply` en la versión del repo. Desde 0.3.0, si `github-rest` es una versión exacta bajo el mínimo que pide esa versión del flujo, la sube. Desde 0.2.6, si a GitHub le faltan labels del flujo (`spike`, `P1`–`P4`…), `issue-flow labels sync` los crea |
| `agent-cloud-kit` | Sesiones en la nube ([`agent-cloud-kit`](https://github.com/ramon-sg/agent-cloud-kit)): herramientas, Docker y el clone completo | `.agents/runner.json` (modo viejo: `version` de `.claude/cloud.json`), `.agents/skills/cloud-ready/` | npm | `agent-cloud-kit init` | Cambia la versión que fija `.agents/runner.json` (en modo viejo, `.claude/cloud.json`) y corre el `init` de la versión nueva, para que la skill `cloud-ready` quede igual. Al terminar `apply` sugiere `agent-cloud-kit prepare` con el ejecutor del repo |
| `claude-repo-guard` | Barandas ([`claude-repo-guard`](https://github.com/ramon-sg/claude-repo-guard)): modo auto con sandbox, escribe solo en su worktree | `.agents/runner.json` (modo viejo: `.claude/repo-guard.manifest.json`) | npm en modo runner; tags `vX.Y.Z` de GitHub en modo viejo | `apply` en esa tag (`install` antes de 0.5.0) | `apply` en la tag nueva |
| `skills` | Skills con [`skills-manager`](https://github.com/ramon-sg/skills-manager): las del flujo y las de [`agent-skills`](https://github.com/ramon-sg/agent-skills) (planes, auditoría de código y de tests) | `.agents/skills.lock.json` | Tags del catálogo | `skills-manager init --select` con las elegidas | `skills-manager update` |
| `agents-md` | Una línea en `AGENTS.md` que le pide al agente mirar la versión instalada de una biblioteca antes de usarla. Si el repo tiene `CLAUDE.md`, le agrega `@AGENTS.md`, porque si no Claude Code no lee `AGENTS.md`. Solo en repos con `package.json`; en modo runner, solo si el repo tiene dependencias propias (sin ellas no hay `node_modules` que mirar) | `AGENTS.md` | — | La escribe `agent-kitchen` | — |

Si npm o GitHub no responden, la pieza se muestra pero no se ofrece actualizarla. Si un paso falla, los demás siguen y el comando dice cómo reintentarlo.

### Cómo se conectan

- **Las skills del flujo van con su CLI,** porque la llaman: se instalan en la tag de la versión del flujo y se mueven con él. Las generales llevan cada una su propia versión.
- **Qué skills:** la primera vez vienen todas las de los catálogos. Con "Elegir" aparece un menú agrupado por catálogo, con la descripción de cada una. Si un catálogo trae skills que el repo no tiene, se ofrecen como un paso sin marcar.
- **Skills propias del repo:** si el repo ya tiene una carpeta con el nombre de una skill del catálogo, pregunta una vez si reemplazarlas. Al reemplazar se conserva su `project.md`. Con `--yes` no se reemplazan: se dejan fuera y lo dice.
- **Seguridad y flujo:** si el repo tiene el flujo, antes de instalar `claude-repo-guard` se escribe en sus opciones que abrir el PR en draft, asignar la issue y agregar el "Slug de rama" son parte del trabajo normal. También se escribe la rama base del flujo como `integrationBranch`. En macOS se agrega `weakerNetworkIsolation`, que `gh` necesita dentro del sandbox. Si `claude-repo-guard` ya estaba al día pero le faltan esas opciones, se ofrecen como un paso.
- **Qué piezas usa el repo:** `.agents/kitchen.json` guarda por pieza si el repo la quiere (`{ "pieces": { "claude-repo-guard": false } }`). Se crea en la primera corrida de `apply` en una terminal: lo instalado cuenta como sí y lo que ofreció y no marcaste, como no. `false` deja la pieza fuera del menú y de `--yes`, sin desinstalarla; la tabla lo dice y `doctor` no corre sus revisiones. Una pieza que el archivo no menciona se ofrece una vez, marcada "(nueva)"; con `--yes` o sin terminal se deja fuera, si no está instalada, y lo dice (una ya instalada se actualiza como siempre). `--yes`, `--dry-run`, `--skip` y las corridas sin terminal nunca escriben el archivo. Se cambia con `apply --pieces` o a mano. `skills-manager` no tiene decisión: sus skills siguen en `.agents/skills.json`.
- **La nube no molesta en local:** el hook de sesión solo actúa en la nube. Un repo que nunca se abre ahí no pierde nada.

## El ejecutor y `.agents/runner.json`

Un repo en **modo runner** corre cada herramienta con el ejecutor y la versión exacta que fija `.agents/runner.json`. Es un archivo que se commitea:

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/@ramon-sg/runner@1.0.0/runner.schema.json",
  "runner": "bun",
  "tools": {
    "@ramon-sg/issue-flow": "0.6.0",
    "@ramon-sg/github-rest": "0.7.0",
    "@ramon-sg/skills-manager": "1.5.1",
    "@ramon-sg/claude-repo-guard": "0.8.0",
    "agent-cloud-kit": "1.0.0"
  }
}
```

- **`runner`** es `"bun"` o `"node"`; sin él, Bun. **`tools`** tiene la versión exacta de cada herramienta, con su nombre de paquete (siempre con el scope).
- **Quién escribe cada entrada:** la herramienta misma, cuando se instala o se actualiza (`issue-flow` la suya y la de `github-rest`, `skills-manager`, `claude-repo-guard` y `agent-cloud-kit` cada una la suya). `agent-kitchen` crea el archivo con el `runner`, y al migrar fija la entrada de una herramienta si ella no lo hizo. Commitea el archivo: es lo que hace que el repo, sus worktrees y la nube corran las mismas versiones.
- **Comandos:** con Bun, `bun x --bun <paquete>@<versión> …`; con Node, `npx --yes <paquete>@<versión> …`. Los hooks y los atajos de `package.json` (`issue:start`, `claude:auto`…) se escriben así, con la versión fija. Las herramientas no pasan por `node_modules`: solo se instala lo que el repo usa por su cuenta.
- **Modo viejo:** un repo sin `.agents/runner.json` sigue como siempre: las versiones en `package.json`, `.claude/cloud.json` y el manifest del guard, y todo con `npx`. Para que un repo nunca quede a medio migrar, en modo viejo solo se ofrecen versiones por debajo de la primera que lee `runner.json`: `issue-flow` 0.6.0, `skills-manager` 1.5.0, `claude-repo-guard` 0.8.0 y `agent-cloud-kit` 1.0.0.
- **Repos nuevos** (sin `runner.json` ni ninguna herramienta instalada) nacen con él. Usa Bun si está instalado; si no, en una terminal pregunta, y sin terminal usa Node y avisa. Con `--dry-run` no escribe nada. `--runner` lo fija sin preguntar.
- **Versiones:** se consultan en el registro de npm: `AGENT_KITCHEN_REGISTRY`, si no `npm_config_registry`, si no `registry.npmjs.org`. Límite conocido: detrás de un proxy HTTP(S) el `fetch` de Node no lo usa, las consultas no devuelven nada y no se ofrece actualizar (no falla).

### Migración de un repo en modo viejo

`apply` ofrece el paso `runner`, "pasar las herramientas a `.agents/runner.json`", cuando el repo tiene herramientas instaladas al modo viejo y **la última versión de cada una en npm ya lee `runner.json`**. Es todo o nada: si a alguna le falta esa versión, o `issue-flow` está en `package.json` con un rango, el paso no aparece y la tabla dice qué falta. También espera si esa corrida deja fuera una pieza con `--skip`. Mientras se ofrece, las herramientas no ofrecen sus pasos del modo viejo.

El paso corre en este orden y se detiene en la primera parte que falla (no deshace nada):

1. Escribe `.agents/runner.json` con el ejecutor (Bun si está instalado) y `github-rest`, sin bajarla nunca. Va primero porque el guard, con su manifest y sin `runner.json`, se queda en modo viejo.
2. `issue-flow apply` en su versión nueva: reescribe sus hooks y atajos.
3. `claude-repo-guard apply` desde npm.
4. `agent-cloud-kit init`.
5. `skills-manager` en su versión nueva, y las skills del flujo a la tag nueva del flujo.
6. La limpieza.

**Lo que quita:** las herramientas del ecosistema de `dependencies` y `devDependencies`, los scripts que eran solo un comando de `skills-manager`, `version` de `.claude/cloud.json`, y `node_modules` y el lockfile **solo si a `package.json` no le queda ninguna dependencia**. **Lo que deja:** el manifest del guard (lo usa su `uninstall`), el archivo `.claude/cloud.json` y `package.json` con los atajos. Si quedan dependencias propias, corre el install del gestor del lockfile al final. Con `--pr`, el commit lleva el lockfile actualizado o borrado.

Si la migración se corta, el repo queda en modo runner con las herramientas que fallaron sin entrada: la siguiente `apply` se las ofrece de nuevo y ofrece "terminar el paso a `.agents/runner.json`", que hace la limpieza que falte. Hay que correrla otra vez hasta que no ofrezca nada.

**Córrelo en tu terminal.** Ni la migración ni el `apply` del guard se corren desde una sesión de Claude Code que ya tenga el guard instalado: el sandbox bloquea `.claude/settings.json`.

### Cambiar de ejecutor

`apply --runner bun|node` cambia el ejecutor de un repo en modo runner: escribe `runner`, corre el `apply` de cada herramienta en su versión (que reescribe hooks y atajos) y ajusta `packageManager` de `package.json` (`bun@<versión>` con Bun, nada con Node), solo si el repo no tiene dependencias propias. En un repo en modo viejo, hace la migración con ese ejecutor. Con el ejecutor que el repo ya tiene, `--runner <el mismo>` vuelve a correr cada herramienta: sirve para terminar un cambio que se cortó a medias. `doctor` no acepta `--runner`.

## Uso

Cada ejemplo funciona con `bun x` o con `npx`, según el ejecutor del repo.

```sh
bun x agent-kitchen apply                      # (con Node: npx) pregunta, en una terminal (Enter: todo lo sugerido)
npx agent-kitchen apply --dry-run              # solo muestra qué haría
npx agent-kitchen apply --yes                  # hace lo sugerido sin preguntar
npx agent-kitchen apply --pr                   # en una copia de origin, y abre un PR en draft
npx agent-kitchen apply --here                 # en la rama actual, sin commit
npx agent-kitchen apply --verbose              # muestra la salida de cada herramienta
npx agent-kitchen apply --skip agent-cloud-kit    # deja fuera una pieza (o varias, con comas)
npx agent-kitchen apply --runner node             # cambia el ejecutor del repo (bun o node): reescribe runner.json, hooks y atajos de cada herramienta; en un repo viejo lo migra con ese ejecutor
npx agent-kitchen apply --pieces               # cambia qué piezas usa el repo (solo en una terminal)
npx agent-kitchen doctor                       # revisa cada pieza con su propio doctor
npx agent-kitchen apply --lang en              # la terminal en inglés (o AGENT_KITCHEN_LANG=en)
```

- **Sin subcomando** (`npx agent-kitchen`) hace lo mismo que `apply`, por ahora, y avisa que se use `apply`. En una versión mayor pasará a solo mostrar el estado.

- **Sin terminal y sin `--yes`** (por ejemplo, desde un agente), solo muestra lo que ofrecería.
- **Corre en el checkout principal,** no en un worktree, y desde tu terminal. Dentro de una sesión de Claude, el sandbox de `claude-repo-guard` no deja escribir `.claude/settings.json`: la migración a `runner.json` y el `apply` del guard se corren en una terminal.
**Dónde trabaja.** En una terminal, sin `--pr` ni `--here`, lo primero que pregunta es dónde aplicar los cambios. Con `--yes`, sin terminal o sin remoto `origin`, trabaja en la rama actual.

**`--pr`** deja los cambios en un PR sin tocar tu rama ni tus archivos:

- **Parte de origin, no de tu rama.** Hace `git fetch` y clona el repo en una carpeta temporal en `origin/<base>`: `baseBranch` de `.agents/flow.json`, si no la rama por defecto de `origin`, si no `main`. Da igual si tu rama está atrás, es otra o tiene cambios: ni tus archivos ni tu `node_modules` cambian. Es un clon y no un worktree porque `issue-flow apply` no corre en un worktree; el clon comparte los objetos del repo, así que no copia el historial.
- **Al terminar,** instala las dependencias en el clon (los hooks del repo pueden necesitarlas; en modo runner, solo si el repo tiene dependencias propias que cambiaron) y hace el commit con los hooks, el nombre y la firma de tu repo. El lockfile entra solo si cambió `package.json`.
- **Sube la rama directo a origin.** Tu repo empuja el commit a `chore/agent-kitchen-apply-<fecha>` sin crear una rama local, y abre el PR en draft con `@ramon-sg/github-rest`. Tras el merge, `git fetch --prune` limpia la referencia `origin/chore/…`.
- **Si algo falla antes del push** (un paso, el install o el commit), no sube nada y deja el clon para revisarlo; la salida dice dónde está. Si el push funciona y el PR falla, la salida dice qué correr.

**`--here`** trabaja en la rama actual, en tus archivos, como `ng update` o `copier update`. Avisa si ya tienes cambios sin commit o si tu rama está atrás de origin según el último fetch. Si los pasos cambiaron `package.json`, corre el `install` de tu gestor de paquetes al final (en modo runner, solo si quedan dependencias en `package.json`). Te queda revisar el diff y hacer commit.

**`doctor`** corre el doctor de cada herramienta en la versión del repo (en modo runner, con el ejecutor del repo). En modo runner también revisa que `.agents/runner.json` sea válido, que el ejecutor esté instalado (`bun` o `npx`) y falla si una herramienta instalada no está fijada en él; cada herramienta pasa además su propio doctor, que revisa sus hooks y atajos. Un `runner.json` que no se puede usar corta el comando con un error. En modo viejo no agrega nada. Las herramientas son: `issue-flow doctor --json`, `skills-manager check` y `claude-repo-guard doctor --json`. Además revisa que `skills-manager` esté al menos en 1.2.0 (en modo runner, anota con `·` un hook `session-notice` que no sea el comando de `runner.json`, como uno viejo con `bunx`, y `apply` lo reescribe), que las skills del flujo estén en la tag de su CLI, qué labels del flujo le faltan a GitHub (con `·`), que la versión de `agent-cloud-kit` sea exacta (en `.agents/runner.json`; en modo viejo, `.claude/cloud.json`) y, en macOS, `weakerNetworkIsolation`. En un repo con `package.json`, también la línea de `AGENTS.md` y, si hay `CLAUDE.md`, su `@AGENTS.md`. Lo que no está instalado o tiene una versión nueva solo se anota con `·`. Sale con 1 si algo falla (`✗`).

**Idioma.** La terminal habla español por defecto. `--lang en`, o la variable `AGENT_KITCHEN_LANG=en`, la pasa a inglés; `--lang` gana sobre la variable, y `LANG` no se mira. agent-kitchen pasa ese idioma a claude-repo-guard (`CLAUDE_REPO_GUARD_LANG`) y a issue-flow (`ISSUE_FLOW_LANG`) cuando los instala o actualiza, así que lo que muestran al fallar sale en el mismo idioma. También lo reciben los `doctor` de las dos y la lectura de los labels de issue-flow, así que un valor que ellas no aceptan en la shell no las hace fallar; cuando agent-kitchen lee el texto del doctor de issue-flow para decidir si reparar, le pide inglés. Lo que queda en el repo no cambia de idioma: el commit y el PR de `--pr`, la línea de `AGENTS.md` y las opciones de `claude-repo-guard`. Los textos están en `src/texts/es.ts` y `src/texts/en.ts`, con el mismo tipo; un test revisa que tengan las mismas claves.

**Kuro.** `apply` y `doctor` terminan con un bloque junto a Kuro, el ninja cocinero de issue-flow: cómo fue, qué falta y el comando siguiente. Los errores que cortan el comando salen igual, en stderr. Kuro solo aparece en una terminal, el color se apaga con `NO_COLOR`, y `"art": false` en `.agents/kitchen.json` o en `.agents/flow.json` lo quita.

## Sumar una pieza

Una pieza es un archivo en `src/pieces/` con dos funciones asíncronas: `status(root)` dice qué tiene el repo y qué pasos ofrece, y `checks(root)` da sus revisiones para `doctor`. Un paso dice qué paquetes descargar antes (`downloads`) y nunca pregunta nada: las preguntas van antes, en `src/menu.ts`. Se registra en `PIECES` de `src/commands/sync.ts` y en `src/commands/doctor.ts`. Cada paso corre la herramienta de la pieza, que es dueña de sus archivos. Un catálogo de skills nuevo es una línea en `GENERAL_CATALOGS` de `src/piece.ts`.

## Desarrollo

```sh
npm install
npm test        # compila y corre los tests
```

Los tests corren el CLI compilado sobre repos reales. `npx`, `bun` y `npm` son falsos (`test/fake-tools.mjs`) y registran cada llamada. Las tags de GitHub salen de repos locales a los que git llega reescribiendo `https://github.com/`, así que `git ls-remote` es el real. Los menús no se prueban renderizados: se prueban `menuOptions` y `skillOptions`, y se corrieron en una terminal con `expect`. Con `@clack/prompts` 1.8.1, una ruedita mostrada antes de una pregunta deja a la segunda pregunta sin teclado; por eso la revisión inicial es una línea de texto.

## Publicar una versión

Una versión es una release `vX.Y.Z` en GitHub, con el mismo número que `package.json`. Al publicarla, GitHub Actions corre los tests y publica en npm con procedencia (`.github/workflows/publish.yml`).

La primera versión va a mano, porque npm solo deja configurar la publicación desde GitHub en un paquete que ya existe:

1. `npm login` y, desde `main`, `npm publish --provenance=false`.
2. En npmjs.com, en el paquete, Settings → Trusted publishing: GitHub Actions, repo `ramon-sg/agent-kitchen`, workflow `publish.yml`.
3. Pushear la tag de esa versión sin crear una release: una release volvería a publicar la misma versión y fallaría.

## Licencia

MIT
