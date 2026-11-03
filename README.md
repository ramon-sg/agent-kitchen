# agent-kitchen

Un solo comando para instalar, actualizar y revisar lo que un repo usa para trabajar con agentes: el flujo de issues con sus skills, las skills generales, las sesiones de Claude en la nube y las barandas de seguridad.

```sh
npx agent-kitchen apply    # muestra qué hay, qué falta y qué está atrasado, y pregunta
npx agent-kitchen doctor   # revisa que todo funcione, sin cambiar nada
```

Qué hace cada herramienta y cada skill, y dónde están: [docs/README.md](docs/README.md) para personas y [docs/agent-guide.md](docs/agent-guide.md) para agentes.

Al arrancar revisa si npm tiene una versión más nueva de sí mismo. Si la hay, corre esa con los mismos argumentos, así que `npx` nunca usa una copia vieja de su caché.

## En simple

- Muestra cada pieza con la versión que tiene el repo y si está al día.
- Pregunta una vez: **todo lo sugerido** (Enter), **elegir** los pasos y las skills, o **salir**. Todas las preguntas van antes de instalar; después corre solo.
- Cada paso es una línea con ✓ o ✗. La salida de cada herramienta solo aparece si falla, o con `--verbose`.
- Es rápido: las versiones se consultan todas a la vez y las herramientas se descargan mientras respondes.
- Cada pieza la instala su propia herramienta. `agent-kitchen` solo sabe cuáles hay, en qué versión están y cómo se conectan entre sí. Las excepciones son una línea de `AGENTS.md` y, en `package.json`, la versión de `skills-manager` y la de `github-rest` cuando queda bajo el mínimo de issue-flow, que escribe él mismo.
- Correrlo de nuevo no rompe nada: si todo está al día, lo dice y termina.

## Las piezas

| Pieza | Qué es | Versión del repo | Última | Instalar | Actualizar |
|---|---|---|---|---|---|
| `skills-manager` | La versión de [`@ramon-sg/skills-manager`](https://github.com/ramon-sg/skills-manager) que corre `agent-kitchen`: como mínimo 1.2.0. Si falta la agrega y si es menor la sube; nunca la baja. Un rango o `workspace:` no se toca, y avisa si la versión que corre queda bajo el mínimo. Solo en repos que usan skills y tienen `package.json`, o donde issue-flow se instala en la misma corrida: entonces crea el `package.json` | `package.json` | — | La agrega `agent-kitchen` | La sube `agent-kitchen` |
| `issue-flow` | Flujo de issues ([`@ramon-sg/issue-flow`](https://github.com/ramon-sg/issue-flow)): rama, worktree y PR en draft por issue, y sus 5 skills | `package.json` | npm | `issue-flow apply` (`init` antes de 0.3.0), y sus skills a la misma tag | `issue-flow apply` en la versión nueva (`upgrade` antes de 0.3.0), y sus skills a la misma tag. Desde 0.3.0, si su doctor ve hooks o el `$schema` atrás, `apply` en la versión del repo. Desde 0.3.0, si `github-rest` es una versión exacta bajo el mínimo que pide esa versión del flujo, la sube. Desde 0.2.6, si a GitHub le faltan labels del flujo (`spike`, `P1`–`P4`…), `issue-flow labels sync` los crea |
| `agent-cloud-kit` | Sesiones en la nube ([`agent-cloud-kit`](https://github.com/ramon-sg/agent-cloud-kit)): herramientas, Docker y el clone completo | `.claude/cloud.json`, `.agents/skills/cloud-ready/` | npm | `agent-cloud-kit init` | Cambia la versión que fija `.claude/cloud.json` y corre el `init` de la versión nueva, para que la skill `cloud-ready` quede igual. Al terminar `apply` sugiere `npx agent-cloud-kit prepare` |
| `claude-repo-guard` | Barandas ([`claude-repo-guard`](https://github.com/ramon-sg/claude-repo-guard)): modo auto con sandbox, escribe solo en su worktree | `.claude/repo-guard.manifest.json` | Tags `vX.Y.Z` de GitHub | `apply` en esa tag (`install` antes de 0.5.0) | `apply` en la tag nueva |
| `skills` | Skills con [`skills-manager`](https://github.com/ramon-sg/skills-manager): las del flujo y las de [`agent-skills`](https://github.com/ramon-sg/agent-skills) (planes, auditoría de código y de tests) | `.agents/skills.lock.json` | Tags del catálogo | `skills-manager init --select` con las elegidas | `skills-manager update` |
| `agents-md` | Una línea en `AGENTS.md` que le pide al agente mirar la versión instalada de una biblioteca antes de usarla. Si el repo tiene `CLAUDE.md`, le agrega `@AGENTS.md`, porque si no Claude Code no lee `AGENTS.md`. Solo en repos con `package.json` | `AGENTS.md` | — | La escribe `agent-kitchen` | — |

Si npm o GitHub no responden, la pieza se muestra pero no se ofrece actualizarla. Si un paso falla, los demás siguen y el comando dice cómo reintentarlo.

### Cómo se conectan

- **Las skills del flujo van con su CLI,** porque la llaman: se instalan en la tag de la versión del flujo y se mueven con él. Las generales llevan cada una su propia versión.
- **Qué skills:** la primera vez vienen todas las de los catálogos. Con "Elegir" aparece un menú agrupado por catálogo, con la descripción de cada una. Si un catálogo trae skills que el repo no tiene, se ofrecen como un paso sin marcar.
- **Skills propias del repo:** si el repo ya tiene una carpeta con el nombre de una skill del catálogo, pregunta una vez si reemplazarlas. Al reemplazar se conserva su `project.md`. Con `--yes` no se reemplazan: se dejan fuera y lo dice.
- **Seguridad y flujo:** si el repo tiene el flujo, antes de instalar `claude-repo-guard` se escribe en sus opciones que abrir el PR en draft, asignar la issue y agregar el "Slug de rama" son parte del trabajo normal. También se escribe la rama base del flujo como `integrationBranch`. En macOS se agrega `weakerNetworkIsolation`, que `gh` necesita dentro del sandbox. Si `claude-repo-guard` ya estaba al día pero le faltan esas opciones, se ofrecen como un paso.
- **Qué piezas usa el repo:** `.agents/kitchen.json` guarda por pieza si el repo la quiere (`{ "pieces": { "claude-repo-guard": false } }`). Se crea en la primera corrida de `apply` en una terminal: lo instalado cuenta como sí y lo que ofreció y no marcaste, como no. `false` deja la pieza fuera del menú y de `--yes`, sin desinstalarla; la tabla lo dice y `doctor` no corre sus revisiones. Una pieza que el archivo no menciona se ofrece una vez, marcada "(nueva)"; con `--yes` o sin terminal se deja fuera, si no está instalada, y lo dice (una ya instalada se actualiza como siempre). `--yes`, `--dry-run`, `--skip` y las corridas sin terminal nunca escriben el archivo. Se cambia con `apply --pieces` o a mano. `skills-manager` no tiene decisión: sus skills siguen en `.agents/skills.json`.
- **La nube no molesta en local:** el hook de sesión solo actúa en la nube. Un repo que nunca se abre ahí no pierde nada.

## Uso

```sh
npx agent-kitchen apply                        # pregunta, en una terminal (Enter: todo lo sugerido)
npx agent-kitchen apply --dry-run              # solo muestra qué haría
npx agent-kitchen apply --yes                  # hace lo sugerido sin preguntar
npx agent-kitchen apply --pr                   # en una copia de origin, y abre un PR en draft
npx agent-kitchen apply --here                 # en la rama actual, sin commit
npx agent-kitchen apply --verbose              # muestra la salida de cada herramienta
npx agent-kitchen apply --skip agent-cloud-kit    # deja fuera una pieza (o varias, con comas)
npx agent-kitchen apply --pieces               # cambia qué piezas usa el repo (solo en una terminal)
npx agent-kitchen doctor                       # revisa cada pieza con su propio doctor
```

- **Sin subcomando** (`npx agent-kitchen`) hace lo mismo que `apply`, por ahora, y avisa que se use `apply`. En una versión mayor pasará a solo mostrar el estado.

- **Sin terminal y sin `--yes`** (por ejemplo, desde un agente), solo muestra lo que ofrecería.
- **Corre en el checkout principal,** no en un worktree, y desde tu terminal. Dentro de una sesión de Claude, el sandbox de `claude-repo-guard` no deja escribir `.claude/settings.json`.
**Dónde trabaja.** En una terminal, sin `--pr` ni `--here`, lo primero que pregunta es dónde aplicar los cambios. Con `--yes`, sin terminal o sin remoto `origin`, trabaja en la rama actual.

**`--pr`** deja los cambios en un PR sin tocar tu rama ni tus archivos:

- **Parte de origin, no de tu rama.** Hace `git fetch` y clona el repo en una carpeta temporal en `origin/<base>`: `baseBranch` de `.agents/flow.json`, si no la rama por defecto de `origin`, si no `main`. Da igual si tu rama está atrás, es otra o tiene cambios: ni tus archivos ni tu `node_modules` cambian. Es un clon y no un worktree porque `issue-flow apply` no corre en un worktree; el clon comparte los objetos del repo, así que no copia el historial.
- **Al terminar,** instala las dependencias en el clon (los hooks del repo pueden necesitarlas) y hace el commit con los hooks, el nombre y la firma de tu repo. El lockfile entra solo si cambió `package.json`.
- **Sube la rama directo a origin.** Tu repo empuja el commit a `chore/agent-kitchen-apply-<fecha>` sin crear una rama local, y abre el PR en draft con `@ramon-sg/github-rest`. Tras el merge, `git fetch --prune` limpia la referencia `origin/chore/…`.
- **Si algo falla antes del push** (un paso, el install o el commit), no sube nada y deja el clon para revisarlo; la salida dice dónde está. Si el push funciona y el PR falla, la salida dice qué correr.

**`--here`** trabaja en la rama actual, en tus archivos, como `ng update` o `copier update`. Avisa si ya tienes cambios sin commit o si tu rama está atrás de origin según el último fetch. Si los pasos cambiaron `package.json`, corre el `install` de tu gestor de paquetes al final. Te queda revisar el diff y hacer commit.

**`doctor`** corre el doctor de cada herramienta en la versión del repo: `issue-flow doctor --json`, `skills-manager check` y `claude-repo-guard doctor --json`. Además revisa que `skills-manager` esté al menos en 1.2.0, que las skills del flujo estén en la tag de su CLI, qué labels del flujo le faltan a GitHub (con `·`), que `.claude/cloud.json` fije una versión exacta y, en macOS, `weakerNetworkIsolation`. En un repo con `package.json`, también la línea de `AGENTS.md` y, si hay `CLAUDE.md`, su `@AGENTS.md`. Lo que no está instalado o tiene una versión nueva solo se anota con `·`. Sale con 1 si algo falla (`✗`).

## Sumar una pieza

Una pieza es un archivo en `src/pieces/` con dos funciones asíncronas: `status(root)` dice qué tiene el repo y qué pasos ofrece, y `checks(root)` da sus revisiones para `doctor`. Un paso dice qué paquetes descargar antes (`downloads`) y nunca pregunta nada: las preguntas van antes, en `src/menu.ts`. Se registra en `PIECES` de `src/commands/sync.ts` y en `src/commands/doctor.ts`. Cada paso corre la herramienta de la pieza, que es dueña de sus archivos. Un catálogo de skills nuevo es una línea en `GENERAL_CATALOGS` de `src/piece.ts`.

## Desarrollo

```sh
npm install
npm test        # compila y corre los tests
```

Los tests corren el CLI compilado sobre repos reales. `npx` y `npm` son falsos (`test/fake-tools.mjs`) y registran cada llamada. Las tags de GitHub salen de repos locales a los que git llega reescribiendo `https://github.com/`, así que `git ls-remote` es el real. Los menús no se prueban renderizados: se prueban `menuOptions` y `skillOptions`, y se corrieron en una terminal con `expect`. Con `@clack/prompts` 1.8.1, una ruedita mostrada antes de una pregunta deja a la segunda pregunta sin teclado; por eso la revisión inicial es una línea de texto.

## Publicar una versión

Una versión es una release `vX.Y.Z` en GitHub, con el mismo número que `package.json`. Al publicarla, GitHub Actions corre los tests y publica en npm con procedencia (`.github/workflows/publish.yml`).

La primera versión va a mano, porque npm solo deja configurar la publicación desde GitHub en un paquete que ya existe:

1. `npm login` y, desde `main`, `npm publish --provenance=false`.
2. En npmjs.com, en el paquete, Settings → Trusted publishing: GitHub Actions, repo `ramon-sg/agent-kitchen`, workflow `publish.yml`.
3. Pushear la tag de esa versión sin crear una release: una release volvería a publicar la misma versión y fallaría.

## Licencia

MIT
