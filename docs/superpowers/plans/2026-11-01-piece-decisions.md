# Decisiones por pieza: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `agent-kitchen apply` guarda en `.agents/kitchen.json` qué piezas quiere el repo y las respeta en cada corrida; `apply --pieces` las cambia.

**Architecture:** Un módulo nuevo, `src/decisions.ts`, lee, calcula y escribe las decisiones. Es puro salvo `readDecisions` y `writeDecisions`. `sync.ts` suma las piezas en `false` a `skip` (así se reusan las dependencias que hoy cuelgan de `--skip`), marca las piezas sin decisión y escribe el archivo tras las preguntas. `doctor.ts` no corre los checks de las piezas en `false`.

**Tech Stack:** TypeScript (ESM, Node ≥ 20), `@clack/prompts` 1.8.1, `node:test` sobre `dist/`.

**Spec:** `docs/superpowers/specs/2026-11-01-piece-decisions-design.md`

## Global Constraints

- Textos para personas en español; comentarios y JSDoc en inglés, con `@example`, como el resto de `src/`.
- Sin dependencias nuevas.
- Todas las preguntas van antes de cualquier paso. No se muestra un spinner antes de una pregunta.
- Piezas decidibles: `issue-flow`, `claude-cloud`, `claude-repo-guard`, `skills`, `agents-md`. `skills-manager` no lleva decisión.
- Archivo: `.agents/kitchen.json`, con la forma `{ "pieces": { "<pieza>": true|false } }`. Lo demás del archivo, incluidas las claves desconocidas dentro de `pieces`, se conserva al reescribirlo.
- `--yes`, `--dry-run`, `--skip` y las corridas sin terminal nunca escriben el archivo.
- Las piezas en `false` no se desinstalan.
- Textos fijos:
  - línea de la tabla: `fuera por decisión del repo`;
  - recordatorio: `Para cambiar qué piezas usa el repo: agent-kitchen apply --pieces (o edita .agents/kitchen.json).`;
  - pieza nueva sin terminal: `Pieza nueva sin decisión: <piezas>. Corre agent-kitchen apply en una terminal para elegir.`;
  - al guardar: `Guardé qué piezas usa el repo en .agents/kitchen.json; commitéalo.`;
  - marca: ` (nueva)`.

## Review Focus

1. **`issue-flow` en `false`.** Las skills del flujo, las opciones del guard y la regla de AGENTS.md deben comportarse como con `--skip issue-flow`. Test en Task 2.
2. **Alguien con una versión vieja reescribe el archivo.** Las claves desconocidas sobreviven. Test en Task 1.
3. **Archivo con JSON roto.** Sale 1 con el mensaje de `readJson` y no lo sobreescribe. Test en Task 2.
4. **Pieza sin decisión ya instalada, con `--yes`** (alguien borró la clave). Se actualiza como `true`, no se salta. Test en Task 2.
5. **`--dry-run` con archivo.** Muestra con las decisiones aplicadas y deja el archivo intacto, byte a byte. Test en Task 2.

Las rutas interactivas (el menú, `--pieces` con terminal) no se pueden probar por CLI, porque los tests corren sin TTY; así lo dice `test/unit.test.mjs`. Su lógica pura se prueba en Task 1. El resto se prueba a mano en una terminal en Task 4.

---

### Task 1: Módulo de decisiones

**Files:**
- Create: `src/decisions.ts`
- Test: `test/decisions.test.mjs`

**Interfaces:**
- Produces:
  - `DECISIONS = ".agents/kitchen.json"`
  - `DECIDABLE: string[]`: los cinco nombres, en el orden de `PIECES` de `sync.ts`. Importa cada `NAME` de su pieza.
  - `interface Saved { pieces: Record<string, boolean>; raw: Record<string, unknown>; warnings: string[] }`
  - `readDecisions(root: string): Saved | null`: `null` si no hay archivo; usa `readJson`, así que el JSON roto lanza `KitError`. Las claves desconocidas o de `skills-manager` no entran en `pieces` y no avisan. Un valor no booleano de una pieza decidible no entra y suma un warning: `.agents/kitchen.json: "<pieza>" no es true ni false; se trata como sin decisión.`
  - `undecided(saved: Saved | null): string[]`: los decidibles sin valor; todos si `saved` es null.
  - `off(saved: Saved | null): string[]`: los que valen `false`.
  - `decide(statuses: PieceStatus[], chosen: Step[], previous: Record<string, boolean>): Record<string, boolean>`: devuelve `previous` más una decisión para cada status decidible sin decisión previa. Instalado → `true`; con algún paso en `chosen` (por `step.piece`) → `true`; con pasos ofrecidos y ninguno elegido → `false`; sin pasos → sin decisión.
  - `writeDecisions(root: string, pieces: Record<string, boolean>, raw: Record<string, unknown>): void`: escribe `{ ...raw, pieces: { ...rawPieces, ...pieces } }` con `writeJson`.

- [ ] **Step 1: Escribir los tests que fallan** en `test/decisions.test.mjs`, importando de `../dist/decisions.js`:
  - `decide`: un status instalado sin pasos da `true`; uno no instalado con un paso elegido da `true`; uno no instalado con pasos no elegidos da `false`; uno instalado con su paso de actualización no elegido da `true`; un nombre ya en `previous` (`{"claude-repo-guard": false}`) no cambia aunque esté instalado; `skills-manager` nunca aparece en el resultado; un status no instalado sin pasos no aparece.
  - `readDecisions` sobre un directorio temporal (`mkdtempSync`): sin archivo da `null`; `{"pieces":{"claude-repo-guard":false,"claude-x":true,"skills-manager":true,"skills":"no"}}` da `pieces` `{"claude-repo-guard": false}` y un warning que nombra `skills`.
  - `writeDecisions` conserva `"claude-x": true` y una clave de nivel superior `"otra": 1`, y agrega `"issue-flow": true`.
  - `undecided(null)` da los cinco; `off` da solo los `false`.

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npm test`
Expected: FAIL, `Cannot find module '../dist/decisions.js'` (o error de `tsc`).

- [ ] **Step 3: Implementar `src/decisions.ts`** con las firmas de arriba y un `@file` que explique el archivo y por qué `skills-manager` no lleva decisión.

- [ ] **Step 4: Correr y ver que pasan**

Run: `npm test`
Expected: PASS, todos los tests.

- [ ] **Step 5: Commit** (con el OK del usuario)

```bash
git add src/decisions.ts test/decisions.test.mjs
git commit -m "feat: módulo de decisiones por pieza"
```

### Task 2: `apply` respeta y guarda las decisiones

**Files:**
- Modify: `src/commands/sync.ts` (`sync`, `printStatus`, y un `statusesOf` que recibe `skip` ya sumado)
- Test: `test/sync.test.mjs` (tests nuevos al final)

**Interfaces:**
- Consumes: todo lo de Task 1.
- Produces: el comportamiento de abajo. `SyncOptions` aún no cambia.

Orden dentro de `sync`, después de `mainCheckout`:
1. `saved = readDecisions(root)`; cada warning va a `warn(out, …)`.
2. `skip = [...options.skip, ...off(saved)]`.
3. `asks = out.interactive && !options.yes && !options.dryRun`.
4. Si `saved !== null`, no `asks` y no `--dry-run`: se calculan los estados. Las piezas de `undecided(saved)` cuyo status existe con `installed: false` se suman a `skip`, se recalculan los estados (las búsquedas están en caché en `tools.ts`) y se imprime la línea "Pieza nueva sin decisión".
5. Si `saved !== null`, cada status de una pieza sin decisión (que siga en la lista) lleva ` (nueva)` al final de `state` y de la `label` de cada paso.
6. `printStatus` recibe `off(saved)` (menos lo que vino en `--skip`) e imprime una fila `<pieza>  fuera por decisión del repo` por cada una, con el mismo ancho. Si hay alguna, imprime el recordatorio debajo de la tabla.
7. Si no hay pasos y `asks`: con `decide(statuses, [], saved?.pieces ?? {})` distinto de `saved?.pieces` (o sin archivo), se escribe y se imprime la línea de "Guardé…". Luego sale con "Todo al día", como hoy.
8. Tras `chooseSteps`, solo si `asks` y devolvió un arreglo (no `"leave"` ni `null`): se aplica la misma regla de escritura con `chosen`, antes de correr los pasos.

- [ ] **Step 1: Escribir los tests que fallan** (CLI sin terminal; `makeRepo`, `installedRepo`):
  - **"a piece set to false is never offered, shown as the repo's decision, and --yes leaves it"**: repo vacío con `{"pieces":{"claude-repo-guard":false}}`; `--yes`. Ninguna llamada a `github:ramon-sg/claude-repo-guard…`; la salida coincide con `/claude-repo-guard +fuera por decisión del repo/` y con `/agent-kitchen apply --pieces/`.
  - **"issue-flow set to false acts like --skip issue-flow"**: mismas aserciones que el test existente "without the issue flow, the guard is not told about it…", pero con el archivo en vez de `--skip`.
  - **"--yes without the file does what it did and writes no file"**: repo vacío, `--yes`; `repo.exists(".agents/kitchen.json") === false`.
  - **"--dry-run and --skip leave the file as it was"**: archivo escrito como texto; tras `--dry-run`, y tras `--yes --skip claude-cloud`, el texto es igual.
  - **"with the file, a new piece is not installed without a terminal, and says so"**: repo vacío con `{"pieces":{"issue-flow":true,"claude-repo-guard":true,"skills":true,"agents-md":true}}`; `--yes`. Ninguna llamada a `@ramon-sg/claude-cloud…`; la salida coincide con `/Pieza nueva sin decisión: claude-cloud\. Corre agent-kitchen apply en una terminal/`; el archivo no cambia.
  - **"with the file, an installed piece without a decision is updated with --yes"**: `installedRepo({ guard: "0.1.0" })` con un archivo sin `claude-repo-guard`; `--yes` llama al guard en `v0.2.0`.
  - **"a non-boolean decision warns and counts as no decision"**: `{"pieces":{"claude-cloud":"no", …los otros true}}`; `--yes`; `r.err` coincide con `/"claude-cloud" no es true ni false/`; claude-cloud no se instala.
  - **"a broken decisions file stops apply and is left as it was"**: escribir `"{"`; sale 1, `r.err` coincide con `/\.agents\/kitchen\.json no es JSON válido/` y el texto no cambió.

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npm test`
Expected: FAIL en los tests nuevos; los existentes pasan.

- [ ] **Step 3: Implementar en `src/commands/sync.ts`** el orden de arriba. Actualizar el `@file` para nombrar `.agents/kitchen.json`.

- [ ] **Step 4: Correr todo**

Run: `npm test`
Expected: PASS, también los tests existentes de `--skip` y `--dry-run`.

- [ ] **Step 5: Commit** (con OK)

```bash
git add src/commands/sync.ts test/sync.test.mjs
git commit -m "feat: apply respeta y guarda qué piezas usa el repo"
```

### Task 3: `apply --pieces` y `doctor`

**Files:**
- Modify: `src/cli.ts` (opción `pieces`, `USAGE`), `src/commands/sync.ts` (`SyncOptions.pieces: boolean`), `src/menu.ts` (`askPieces`), `src/commands/doctor.ts`
- Test: `test/cli.test.mjs`, `test/doctor.test.mjs`, `test/unit.test.mjs`

**Interfaces:**
- Consumes: Task 1, y el `sync` de Task 2.
- Produces:
  - `askPieces(names: string[], ticked: string[]): Promise<string[] | null>` en `src/menu.ts`: un `multiselect` con `message: "¿Qué piezas usa este repo?"` y `required: false`; `null` al cancelar.
  - `pieceOptions(names: string[], ticked: string[]): { options: { value: string; label: string }[]; initialValues: string[] }`: puro, para el test unitario, como `menuOptions`.

Reglas:
- `--pieces` con `--yes` o con `--dry-run`: `UsageError("usa --pieces solo, sin --yes ni --dry-run.")`.
- `--pieces` sin terminal: `UsageError("--pieces pregunta qué piezas usa el repo; córrelo en una terminal.")`.
- Con terminal: se calculan los estados con `skip = options.skip`. Quedan marcadas las piezas en `true`, y las sin decisión que están instaladas. Al confirmar, `writeDecisions` escribe todas las de `DECIDABLE` (marcada → `true`, no marcada → `false`) y se imprime "Guardé…". Luego `sync` sigue como siempre, leyendo el archivo nuevo. Al cancelar: "No se cambió nada." y sale 0.
- `doctor`: lee `readDecisions`. Para cada pieza en `false`, en vez de su función de checks, va `{ name, status: "info", detail: "fuera por decisión del repo" }`. Sus warnings van a stderr.

- [ ] **Step 1: Escribir los tests que fallan**
  - `cli.test.mjs`, **"--pieces needs a terminal and goes alone"**: `apply --pieces --yes` y `apply --pieces --dry-run` salen 2 y coinciden con `/sin --yes ni --dry-run/`; `apply --pieces` sin terminal sale 2 y coincide con `/córrelo en una terminal/`. Ninguno escribe el archivo.
  - `unit.test.mjs`, **"the pieces menu starts with the ticked pieces, in order"**: `pieceOptions(["issue-flow","claude-repo-guard"], ["issue-flow"])` da `initialValues: ["issue-flow"]` y las labels en ese orden.
  - `doctor.test.mjs`, **"doctor notes a piece the repo left out and does not ask its tool"**: `installedRepo()` con `{"pieces":{"claude-repo-guard":false}}`. La salida coincide con `/· claude-repo-guard: fuera por decisión del repo/`, ninguna llamada empieza con `github:ramon-sg/claude-repo-guard` y sale 0.

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npm test`
Expected: FAIL en esos tres.

- [ ] **Step 3: Implementar** según las reglas de arriba. `USAGE` suma `agent-kitchen apply --pieces` y una frase: elige qué piezas usa el repo y lo guarda en `.agents/kitchen.json`.

- [ ] **Step 4: Correr todo**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit** (con OK)

```bash
git add src/cli.ts src/menu.ts src/commands/sync.ts src/commands/doctor.ts test/cli.test.mjs test/doctor.test.mjs test/unit.test.mjs
git commit -m "feat: apply --pieces cambia qué piezas usa el repo; doctor lo respeta"
```

### Task 4: Documentación y prueba a mano

**Files:**
- Modify: `README.md` (sección "Uso": la línea de `--pieces`; "Cómo se conectan": un punto "Qué piezas usa el repo"), `docs/agent-guide.md` ("Mapa de archivos del repo": fila de `.agents/kitchen.json`, que escriben `agent-kitchen` y el usuario)

- [ ] **Step 1: Escribir la documentación**, en el tono del README: oraciones cortas y la respuesta primero. Debe cubrir:
  - se crea en la primera corrida con terminal;
  - `false` deja la pieza fuera sin desinstalar;
  - una pieza nueva se ofrece una vez;
  - `--yes` nunca escribe el archivo;
  - se cambia con `--pieces` o a mano.

- [ ] **Step 2: Probar a mano en una terminal**, en un repo temporal (`git init` en el scratchpad) con `node <worktree>/dist/cli.js`:
  1. `apply`, desmarcar el guard → el archivo queda con `"claude-repo-guard": false`.
  2. `apply` otra vez → no pregunta por el guard; se ven la fila y el recordatorio.
  3. `apply --pieces`, marcar el guard → el archivo cambia y el menú ofrece instalarlo.
  4. "Salir sin cambiar nada" en un repo sin archivo → no se escribe.

  Anotar lo visto en la descripción del PR.

- [ ] **Step 3: Correr todo**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit** (con OK)

```bash
git add README.md docs/agent-guide.md
git commit -m "docs: qué piezas usa el repo y apply --pieces"
```
