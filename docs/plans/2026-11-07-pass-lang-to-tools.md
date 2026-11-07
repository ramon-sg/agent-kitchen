---
status: in progress
type: feature
prs: []
issue: 45
---

# Pasar el idioma de la terminal a claude-repo-guard e issue-flow — plan de implementación

> **Para agentes:** usar superpowers:subagent-driven-development o superpowers:executing-plans, tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** con `--lang en` (o `AGENT_KITCHEN_LANG=en`), los pasos que corren claude-repo-guard e issue-flow les pasan `CLAUDE_REPO_GUARD_LANG=en` e `ISSUE_FLOW_LANG=en`, y lo que muestran al fallar sale en inglés.

**Arquitectura:** `runNpx` y `captureNpx` (`src/tools.ts`) aceptan un `env` opcional que pasan a `run()`, que ya lo mezcla con `process.env`. `src/texts/index.ts` guarda el idioma que eligió `useLang` y lo expone con `currentLang()`. Cada pieza arma su variable con ese idioma y la pasa solo en los pasos que instalan o cambian algo.

**Stack:** TypeScript (tsc), `node --test` sobre `dist/`, con `test/fake-tools.mjs` como npx falso.

**Spec:** [issue #45](https://github.com/ramon-sg/agent-kitchen/issues/45).

## Restricciones globales

- Nombres exactos de las variables: `CLAUDE_REPO_GUARD_LANG` (claude-repo-guard ≥ 0.7.0) e `ISSUE_FLOW_LANG` (issue-flow). Valores: `es` o `en`.
- Sin nada (ni `--lang` ni `AGENT_KITCHEN_LANG`), la variable llega con `es`, no vacía ni ausente.
- No se mira la versión instalada: una versión que no conoce la variable la ignora.
- Fuera de alcance: `doctor --json`, `labels sync --dry-run --json` y lo que se escribe en el repo (commit, PR, `AGENTS.md`). Esas lecturas **no** reciben la variable (ver decisión 1).
- agent-cloud-kit y skills-manager no cambian.

## Decisiones

1. **Solo los pasos que escriben reciben la variable**, no las lecturas `--json`. `needsRepair` de `src/pieces/issue-flow.ts` busca `^at X.Y.Z` y `$schema` en el `detail` del doctor de issue-flow; si ese texto se traduce, la lectura podría romperse. La issue deja `doctor --json` fuera, así que no se arriesga.
2. **El idioma de agent-kitchen manda** sobre un `CLAUDE_REPO_GUARD_LANG` o `ISSUE_FLOW_LANG` que ya tenga la shell, igual que `--lang` manda sobre `AGENT_KITCHEN_LANG`. Así la terminal habla un solo idioma.
3. **Cada herramienta recibe solo su variable**, no las dos.

## Revisar con cuidado

1. La shell que corre los tests tiene `CLAUDE_REPO_GUARD_LANG` o `ISSUE_FLOW_LANG`: los tests no deben depender de eso → `helpers.mjs` las vacía, como ya hace con `AGENT_KITCHEN_LANG` (Tarea 1).
2. La shell tiene `CLAUDE_REPO_GUARD_LANG=fr`: agent-kitchen la pisa con su idioma y el guard no falla por eso → test en Tarea 1.
3. `doctor` con `--lang en`: el doctor de issue-flow y el del guard **no** reciben la variable → test en Tarea 1.
4. issue-flow anterior a 0.3.0 (`init`/`upgrade` por `runFlow`) y `labels sync`: también reciben `ISSUE_FLOW_LANG`, porque su salida se muestra al fallar → cubierto por la Tarea 1 al pasar el env dentro de `runFlow`.
5. `apply --pr` (clon temporal): corre las mismas piezas, así que hereda el comportamiento sin cambios; no lleva test propio.

---

### Tarea 1: el idioma llega a claude-repo-guard e issue-flow

**Archivos:**
- Modificar: `src/tools.ts` — `runNpx`, `captureNpx`
- Modificar: `src/texts/index.ts` — `useLang`, nueva `currentLang`
- Modificar: `src/pieces/guard.ts` — `install` (línea ~116)
- Modificar: `src/pieces/issue-flow.ts` — `runFlow` (~115) y `applyFlow` (~130)
- Modificar: `test/fake-tools.mjs` — la línea que escribe en `FAKE_LOG`
- Modificar: `test/helpers.mjs` — `env()` dentro de `makeRepo`
- Test: `test/lang.test.mjs`

**Interfaces:**
- Produce: `runNpx(root: string, args: string[], env?: NodeJS.ProcessEnv): Promise<ToolRun>`
- Produce: `captureNpx(root: string, args: string[], lookup = false, env?: NodeJS.ProcessEnv)` — mismo retorno que hoy.
- Produce: `currentLang(): Lang` en `src/texts/index.ts`; `"es"` hasta que se llame `useLang`.
- Produce: en `guard.ts`, `const LANG_VAR = "CLAUDE_REPO_GUARD_LANG"`; en `issue-flow.ts`, `const LANG_VAR = "ISSUE_FLOW_LANG"`. Cada pieza pasa `{ [LANG_VAR]: currentLang() }`.

- [ ] **Paso 1: el npx falso registra las dos variables, y los tests parten sin ellas**

En `test/fake-tools.mjs`, el objeto que se escribe en `FAKE_LOG` suma `guardLang: process.env.CLAUDE_REPO_GUARD_LANG || null` y `flowLang: process.env.ISSUE_FLOW_LANG || null`. En `test/helpers.mjs`, `env()` suma `CLAUDE_REPO_GUARD_LANG: ""` e `ISSUE_FLOW_LANG: ""` junto a `AGENT_KITCHEN_LANG: ""`. Actualizar el comentario de cabecera de `fake-tools.mjs` ("Each call logs GH_REPO too" → también las dos variables).

- [ ] **Paso 2: escribir los tests que fallan**, en `test/lang.test.mjs`, con `makeRepo` y `FAKE_NPM` con `@ramon-sg/issue-flow` en `"0.3.0"` (así corre `apply --yes --json`). Ayudantes locales: `guardRuns = (repo) => repo.log().filter((c) => String(c.args[1]).startsWith("github:ramon-sg/claude-repo-guard"))` y `flowRuns` igual con `"@ramon-sg/issue-flow@"`; `cmd = (c) => c.args.slice(2).join(" ")`.

```js
test("with --lang en, the guard's and the flow's apply get their language in en", () => {
  const repo = makeRepo();
  const r = repo.cli(["--yes", "--lang", "en"], { env: { FAKE_NPM: npm030 } });
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(guardRuns(repo).filter((c) => cmd(c).startsWith("apply")).map((c) => c.guardLang), ["en"]);
  assert.deepEqual(flowRuns(repo).filter((c) => cmd(c).startsWith("apply")).map((c) => c.flowLang), ["en"]);
});

test("with no language asked for, they get es", () => {
  // igual, sin --lang: guardLang y flowLang son "es"
});

test("agent-kitchen's language wins over one the shell already has", () => {
  // --lang en con env { CLAUDE_REPO_GUARD_LANG: "fr", ISSUE_FLOW_LANG: "fr" }: status 0 y ambas "en"
});

test("each tool gets only its own variable, and doctor gets none", () => {
  // tras el apply de arriba: las llamadas del guard tienen flowLang null y las del flow guardLang null.
  // Luego repo.cli(["doctor", "--lang", "en"]): toda llamada con "doctor" tiene guardLang y flowLang null.
});
```

`npm030` es `JSON.stringify({ ...NPM, "@ramon-sg/issue-flow": "0.3.0" })` con `NPM` de `helpers.mjs`. Si `makeRepo()` sin más no lleva a instalar el guard y el flow con `--yes`, copiar el arreglo de `test/flow-apply.test.mjs` ("installing 0.3.0 runs its apply…").

- [ ] **Paso 3: correr y ver que fallan**

Run: `npm test 2>&1 | grep -A3 "not ok"`
Esperado: los cuatro tests nuevos fallan con `guardLang`/`flowLang` en `null` donde se esperaba `"en"`/`"es"` (el último pasa ya en su mitad de doctor; está bien).

- [ ] **Paso 4: implementar**

- `src/tools.ts`: `runNpx` y `captureNpx` reciben `env?` y lo pasan a `run(..., { env })`. Documentar el parámetro en el JSDoc.
- `src/texts/index.ts`: `useLang` guarda el idioma en una variable del módulo; `currentLang()` la devuelve.
- `src/pieces/guard.ts`: `install` pasa `{ [LANG_VAR]: currentLang() }` a `runNpx`. `guardChecks` no cambia.
- `src/pieces/issue-flow.ts`: `runFlow` pasa el env a `runNpx`; `applyFlow` lo pasa a `captureNpx` (`lookup` en `false`). `flowDoctor` y `missingLabels` no cambian.

- [ ] **Paso 5: correr todo y ver que pasa**

Run: `npm test`
Esperado: 0 fallos.

- [ ] **Paso 6: commit**

```bash
git add src/tools.ts src/texts/index.ts src/pieces/guard.ts src/pieces/issue-flow.ts test/fake-tools.mjs test/helpers.mjs test/lang.test.mjs
git commit -m "feat: claude-repo-guard e issue-flow hablan el idioma de la terminal"
```

### Tarea 2: documentación

**Archivos:**
- Modificar: `docs/agent-guide.md` — el párrafo que termina en "La terminal habla español por defecto; `--lang en` … la pasa a inglés."
- Modificar: `README.md:79` y `README.en.md:79` — el párrafo **Idioma** / **Language**.

- [ ] **Paso 1:** agregar una oración: "agent-kitchen pasa ese idioma a claude-repo-guard (`CLAUDE_REPO_GUARD_LANG`) y a issue-flow (`ISSUE_FLOW_LANG`) al instalarlos o actualizarlos; sus `doctor --json` siguen sin él."
- [ ] **Paso 2:** `npm test` (incluye `pack.test.mjs`), esperado 0 fallos.
- [ ] **Paso 3:** commit `docs: el idioma también llega a claude-repo-guard e issue-flow`.

## Desvíos

- Tarea 1: los tests nuevos usan claude-repo-guard 0.7.0 y no el 0.2.0 de `makeRepo()`, porque 0.2.0 instala con `install` y la variable existe desde 0.7.0. El código no depende de la versión.
- Revisión final: la decisión 1 estaba mal. Desde issue-flow 0.5.0, su `doctor --json` habla español si no recibe `ISSUE_FLOW_LANG`, y `needsRepair` busca `at X.Y.Z`: con un hook más nuevo, agent-kitchen proponía un `apply` que issue-flow rechaza. Ahora la lectura de `needsRepair` pide `en`, y el `doctor` de agent-kitchen pasa el idioma de la terminal. El doctor de claude-repo-guard sigue sin la variable, como pide la issue.
