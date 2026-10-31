---
status: in-progress
type: feature
prs: [20]
issue: 15
---

# agent-kitchen instala y actualiza issue-flow con su apply

## En simple

**Decisión:** desde issue-flow 0.3.0, agent-kitchen corre su apply para instalar, actualizar y reparar el flujo.

### Hoy: dos comandos que van a desaparecer
agent-kitchen corre init para instalar y upgrade para actualizar ([V1](#v1)). En 0.3.0 los dos avisan y se van en 0.4.0 ([V2](#v2)).

### Después: un solo apply, que también repara
Al instalar o subir a 0.3.0 corre apply y muestra qué cambió ([etapa 1](#etapa-1)). Si Dependabot subió la versión y los hooks quedaron atrás, ofrece apply en esa versión ([etapa 1](#etapa-1)).

### Riesgo: apply se niega
Si un hook quedó más nuevo que package.json, apply falla ([V3](#v3)). El paso sale con ✗ y dice el comando para reintentar.

**Fuera:** cambiar qué escribe apply y subir un github-rest viejo (otra issue).

## Etapas

| # | Etapa | Estado | PR |
|---|---|---|---|
| 1 | `issue-flow apply` desde 0.3.0 para instalar, actualizar y reparar | en curso | [#20](https://github.com/ramon-sg/agent-kitchen/pull/20) |

## Decisiones propias

- **El mínimo es 0.3.0,** la primera versión con `apply` ([V2](#v2)). Con una más vieja, `init` y `upgrade` como hoy. Es lo mismo que hace `APPLY_SINCE` de claude-repo-guard ([V4](#v4)).
- **Siempre `apply --yes --json`:** sin `--yes`, sin terminal y con recetas que ofrecer, apply no escribe y sale con 1. Con `--yes` toma las recetas detectadas, como hoy `init --yes` ([V3](#v3)).
- **Lo que apply deja sin tocar (`kept`, por ejemplo un `github-rest` viejo) va como nota del paso,** porque de otro modo nadie lo ve. Subir github-rest queda para otra issue: apply ya no lo sube ([V8](#v8)), pero kaname tiene 0.3.0 y el doctor del flujo lo marca. Lo aprobó el usuario.
- **Repo sin package.json:** la pieza `skills-manager` también aparece si issue-flow se va a instalar en la corrida, como la guard y `agents-md`. Su paso corre primero y, sin package.json, lo crea con `private: true` y skills-manager 1.2.0; apply agrega lo suyo encima ([V7](#v7)). Así cada pieza escribe solo su versión. Lo aprobó el usuario.
- **Un `--json` que no se puede leer cuenta como falla,** aunque apply salga con 0: no se sabe si escribió.
- **La reparación solo mira los hooks y el `$schema`,** lo que pide la issue. Se dispara con un check `<evento> hook` en falla, o con `.agents/flow.json` en falla y `$schema` en su detalle; una config inválida no, porque apply no la arregla ([V5](#v5), [S1](#s1)). El `doctor` del flujo se corre en el estado solo si el repo está en ≥0.3.0 y no está atrás (también con npm caído), en paralelo con los labels.
- **Instalar, actualizar y reparar terminan igual:** apply y luego las skills del flujo a `v<versión>`, como pide la issue. Al instalar, si el repo aún no tiene el catálogo del flujo, no hay nada que mover ([V1](#v1)).
- **Con `--verbose`, la salida de apply no se ve en vivo,** porque hay que leer su JSON. Si falla, se muestra igual que hoy.
- **Nada más cambia alrededor:** apply corre en la copia principal, como ya corre agent-kitchen ([V6](#v6)).
- **Sin cambios en `agent-kitchen doctor`:** ya muestra las líneas del `doctor` del flujo, y en 0.3.0 esas líneas dicen qué correr ([V5](#v5)).

## Contraste con la realidad

2026-10-31, rama `feat/15-issue-flow-apply`, commit `5fe1a35`; issue-flow en la tag `v0.3.0`.

| Id | Afirmación | Evidencia | Resultado |
|---|---|---|---|
| <a id="v1"></a>V1 | Instalar corre `init --yes` en la última; actualizar, `upgrade` y luego `moveSkills` | `src/pieces/issue-flow.ts:143`, `:145` | ✔ |
| <a id="v2"></a>V2 | `apply` llega en 0.3.0; `init` y `upgrade` avisan y se van en 0.4.0 | npm `latest` = 0.3.0, versiones 0.2.5–0.3.0; issue-flow `src/cli-setup.ts:37` en v0.3.0 | ✔ |
| <a id="v3"></a>V3 | `apply --json` imprime `{version, changes, kept, written, next}` y sale con 0. Si se niega (package.json o un hook más nuevos, un rango, un worktree), escribe `issue-flow: <motivo>` en stderr y sale con 1; con una config inválida, con 2. `--yes` toma las recetas detectadas | issue-flow v0.3.0 `src/commands/apply.ts:111`, `:131-137`, `:213`, `:237`; `src/cli.ts:377-378` | ✔ corregida: decía solo package.json y salida 1 |
| <a id="v4"></a>V4 | claude-repo-guard elige el comando con `APPLY_SINCE` | `src/pieces/guard.ts:50`, `:62` | ✔ |
| <a id="v5"></a>V5 | El `doctor --json` del flujo nombra los hooks `<evento> hook`. El check `.agents/flow.json` falla con un `$schema` viejo y también con una config inválida | issue-flow v0.3.0 `src/commands/doctor.ts:52`, `:55`, `:86` | ✔ corregida: no decía lo de la config inválida |
| <a id="v6"></a>V6 | agent-kitchen corre los pasos en la copia principal, y apply también lo exige | `src/commands/sync.ts:221` (`mainCheckout`); issue-flow `apply.ts:213` | ✔ |
| <a id="v7"></a>V7 | `apply` no agrega skills-manager. La pieza `skills-manager` solo aparece si package.json ya existe; hoy lo cubre `init` de 0.2.x, que lo agrega | issue-flow v0.3.0 `src/package-edits.ts:149`; v0.2.7 `src/package-edits.ts:128`; `src/pieces/skills-manager.ts:52` | ✔ corregida: decía que la pieza lo agrega siempre |
| <a id="v8"></a>V8 | `upgrade` 0.2.7 subía github-rest; `apply` 0.3.0 lo deja con "raise it" y pide ≥0.3.0 | issue-flow v0.2.7 `src/commands/upgrade.ts:3-4`; v0.3.0 `src/package-edits.ts:161-162`, `package.json:20` | ✔ |
| <a id="s1"></a>S1 | El detalle del check `.agents/flow.json` sigue nombrando `$schema` en las próximas versiones | Texto de issue-flow, no un contrato | supuesto |

## Detalle para agentes

### <a id="etapa-1"></a>Etapa 1: `issue-flow apply` desde 0.3.0

- **Archivos:**
  - `src/pieces/issue-flow.ts`: `APPLY_SINCE = "0.3.0"`. Una función `applyFlow(context, version)` que corre `apply --yes --json`, lee el JSON, anota `kept` y, si falla, llama a `context.fail` con `npx @ramon-sg/issue-flow@<versión> apply --yes`. `stepFor` la usa para instalar y actualizar desde 0.3.0, y para un paso nuevo "Reparar issue-flow X: hooks y $schema" cuando el repo no está atrás y el `doctor` del flujo falla en eso. Los tres pasos siguen con `moveSkills`. El encabezado del archivo se actualiza.
  - `src/tools.ts`: `captureNpx` devuelve también `err`, para mostrar el motivo de la falla.
  - `src/pieces/skills-manager.ts` y `src/commands/sync.ts`: `skillsManagerStatus` recibe si issue-flow viene (la promesa `flowComing` de `statusesOf`, sin cambiar el orden del arreglo). Sin package.json y con el flujo por venir, el paso dice "Crear package.json con skills-manager 1.2.0" y lo crea al correr si sigue faltando.
  - `README.md` (fila `issue-flow`) y `docs/agent-guide.md` (filas de `package.json`, `.agents/flow.json`, `.claude/settings.json` y versiones): `apply` desde 0.3.0; `init` y `upgrade` antes.
  - `test/fake-tools.mjs`: `apply` desde 0.3.0, como el real: fija su versión, crea `.agents/flow.json` si falta, imprime el JSON (con `FAKE_FLOW_KEPT`), o imprime `FAKE_FLOW_APPLY_OUT` en vez del JSON, o escribe `FAKE_FLOW_APPLY_ERROR` en stderr y sale con 1. No agrega skills-manager ni github-rest. Antes de 0.3.0, comando desconocido.
- **Tests, en orden** (`test/flow-apply.test.mjs`, con la CLI de `dist/`):
  1. Sin flujo y con 0.3.0 en npm, `apply --yes` corre `apply --yes --json` y no `init`; con el catálogo del flujo en el manifiesto, después corre `skills-manager update`. Falla hoy.
  2. De 0.2.7 a 0.3.0 corre `apply` y luego mueve las skills del flujo a `v0.3.0`.
  3. Con 0.2.6 en npm, sigue `init --yes` (y `upgrade` de 0.2.0 a 0.2.6).
  4. Si apply falla, el paso sale con ✗, muestra el motivo y dice `npx @ramon-sg/issue-flow@0.3.0 apply --yes`.
  5. Con salida que no es JSON y estado 0, también sale con ✗.
  6. `kept` aparece como nota del paso.
  7. En 0.3.0 y al día, con el `doctor` del flujo fallando en un hook o en el `$schema`, se ofrece "Reparar" y corre `apply` en 0.3.0. Con el `doctor` bien, no hay paso. Con `github-rest` o con una config inválida fallando, tampoco.
  8. Con 0.2.7 al día, no se corre el `doctor` del flujo en el estado. Con npm caído y el repo en 0.3.0, sí.
  9. Tras instalar con apply, el paso de labels corre (el repo ya tiene la versión).
  10. En un repo sin package.json, con skills, `apply --yes` deja `private: true`, skills-manager 1.2.0 e issue-flow 0.3.0, y el paso de skills corre `@ramon-sg/skills-manager@1.2.0`. Con `--skip issue-flow` y sin package.json, la pieza no aparece.
- **Siguen pasando:** `test/sync.test.mjs`, `test/labels.test.mjs`, `test/doctor.test.mjs`, `test/cli.test.mjs` y `test/skills-manager.test.mjs`, que usan 0.2.0–0.2.6 y siguen por `init` y `upgrade`. Que pasen no prueba la ruta nueva; la prueban los tests 1–9.
- **Ojo:** el paso de reparar no debe aparecer junto al de actualizar. Con npm caído (`latest` null) y el repo en 0.3.0, la reparación se ofrece igual, porque usa la versión del repo. Si en el menú se desmarca issue-flow y se deja skills-manager, el package.json se crea igual: el paso lo dice en su texto.
- **Hecho cuando:** `npm test` pasa. En un repo temporal con issue-flow 0.2.7, `AGENT_KITCHEN_HANDED_OVER=1 node <worktree>/dist/cli.js apply --dry-run` ofrece "Actualizar issue-flow 0.2.7 → 0.3.0", y con `--yes` corre el `apply` real de 0.3.0.

## Desvíos

- Etapa 1: `npm test` pasa con 90 tests (14 nuevos en `test/flow-apply.test.mjs`). Cada parte nueva tiene un test que falla si se rompe: el disparador por `$schema`, mover las skills al instalar, la salida sin JSON y el `doctor` con npm caído. Con issue-flow 0.3.0 real, en un repo temporal: `apply --yes` sube 0.2.7 → 0.3.0, y con un hook vuelto a 0.2.7 ofrece "Reparar issue-flow 0.3.0" y lo deja limpio. Desvíos:
  - `test/sync.test.mjs`: si issue-flow falla al instalar, el paso de skills ahora corre `skills-manager@1.2.0` y no `@1`, porque el paso de skills-manager ya creó el `package.json`.
  - El `doctor` del flujo se lee con una sola función, `flowDoctor`, que usan el estado y `issueFlowChecks`.
  - Por `code-audit`: el `doctor` del flujo en el estado usa el tope de las lecturas, para que con npm caído no cuelgue el menú. Un hook más nuevo que el repo no dispara reparar, porque apply se negaría. Se sumaron tests de reparar que mueve las skills y de 0.3.0 → 0.3.1 sin reparar; cada uno falla con su mutación.
