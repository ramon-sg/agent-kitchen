/**
 * @file The texts in Spanish. The menu orders ("Actualizar"), progress says what is happening
 * ("Actualizando") and the end line says what is left ("actualizado").
 */
import type { Catalog } from "./catalog.js";

/**
 * A list of names, joined with commas.
 * @param names - The names.
 * @returns The list.
 */
const list = (names: string[]): string => names.join(", ");

/** The texts in Spanish. */
export const es: Catalog = {
  steps: {
    "skills-manager-create": ({ version }) => ({
      menu: `Crear package.json con skills-manager ${version}`,
      doing: `Creando package.json con skills-manager ${version}…`,
      done: `package.json creado con skills-manager ${version}`,
    }),
    "skills-manager-add": ({ version }) => ({
      menu: `Agregar skills-manager ${version} a package.json`,
      doing: `Agregando skills-manager ${version} a package.json…`,
      done: `skills-manager ${version} agregado a package.json`,
    }),
    "skills-manager-bump": ({ from, to }) => ({
      menu: `Subir skills-manager ${from} → ${to}, el mínimo de agent-kitchen`,
      doing: `Subiendo skills-manager de ${from} a ${to}…`,
      done: `skills-manager subido de ${from} a ${to}`,
    }),
    "flow-install": ({ version }) => ({
      menu: `Instalar issue-flow ${version}: config del flujo, hooks y scripts`,
      doing: `Instalando issue-flow ${version}…`,
      done: `issue-flow ${version} instalado: config del flujo, hooks y scripts`,
    }),
    "flow-update": ({ from, to }) => ({
      menu: `Actualizar issue-flow ${from} → ${to}, con sus hooks y sus skills`,
      doing: `Actualizando issue-flow de ${from} a ${to}…`,
      done: `issue-flow actualizado de ${from} a ${to}, con sus hooks y sus skills`,
    }),
    "flow-repair": ({ version }) => ({
      menu: `Reparar issue-flow ${version}: hooks y $schema`,
      doing: `Reparando issue-flow ${version}…`,
      done: `issue-flow ${version} reparado: hooks y $schema`,
    }),
    "flow-skills": ({ version }) => ({
      menu: `Poner las skills del flujo en v${version}, la versión de issue-flow`,
      doing: `Poniendo las skills del flujo en v${version}…`,
      done: `Skills del flujo en v${version}, la versión de issue-flow`,
    }),
    "flow-labels": ({ missing }) => ({
      menu: `Crear en GitHub los labels que faltan: ${list(missing)}`,
      doing: `Creando en GitHub los labels que faltan: ${list(missing)}…`,
      done: `Labels creados en GitHub: ${list(missing)}`,
    }),
    "github-rest-bump": ({ from, to, flow }) => ({
      menu: `Subir github-rest ${from} → ${to}, el mínimo de issue-flow ${flow}`,
      doing: `Subiendo github-rest de ${from} a ${to}…`,
      done: `github-rest subido de ${from} a ${to}, el mínimo de issue-flow ${flow}`,
    }),
    "cloud-install": ({ version }) => ({
      menu: `Instalar agent-cloud-kit ${version ?? "1.x"}: prepara las sesiones en la nube de Claude`,
      doing: `Instalando agent-cloud-kit ${version ?? "1.x"}…`,
      done: `agent-cloud-kit ${version ?? "1.x"} instalado: prepara las sesiones en la nube de Claude`,
    }),
    "cloud-update": ({ from, to, config }) => ({
      menu: `Actualizar agent-cloud-kit ${from ?? "?"} → ${to} (la versión que fija ${config})`,
      doing: `Actualizando agent-cloud-kit de ${from ?? "?"} a ${to}…`,
      done: `agent-cloud-kit actualizado de ${from ?? "?"} a ${to} en ${config}`,
    }),
    "guard-install": ({ version }) => ({
      menu: `Instalar claude-repo-guard ${version ?? "(main)"}: modo auto con sandbox, y un documento de qué protege`,
      doing: `Instalando claude-repo-guard ${version ?? "(main)"}…`,
      done: `claude-repo-guard ${version ?? "(main)"} instalado: modo auto con sandbox, y un documento de qué protege`,
    }),
    "guard-update": ({ from, to }) => ({
      menu: `Actualizar claude-repo-guard ${from ?? "?"} → ${to}`,
      doing: `Actualizando claude-repo-guard de ${from ?? "?"} a ${to}…`,
      done: `claude-repo-guard actualizado de ${from ?? "?"} a ${to}`,
    }),
    "guard-adjust": () => ({
      menu: "Ajustar claude-repo-guard a lo que necesita el flujo de issues",
      doing: "Ajustando claude-repo-guard al flujo de issues…",
      done: "claude-repo-guard ajustado a lo que necesita el flujo de issues",
    }),
    "skills-install": ({ count, catalogs }) => ({
      menu: `Instalar ${count} skills de ${catalogs.join(" y ")}`,
      doing: `Instalando ${count} skills de ${catalogs.join(" y ")}…`,
      done: `${count} skills instaladas de ${catalogs.join(" y ")}`,
    }),
    "skills-update": ({ catalog, from, to, names }) => ({
      menu: `Actualizar skills de ${catalog} ${from} → v${to}: ${list(names)}`,
      doing: `Actualizando skills de ${catalog} de ${from} a v${to}…`,
      done: `Skills de ${catalog} actualizadas a v${to}: ${list(names)}`,
    }),
    "skills-add": ({ names }) => ({
      menu: `Agregar skills nuevas (${names.length}): ${list(names)}`,
      doing: `Agregando skills nuevas: ${list(names)}…`,
      done: `Skills nuevas agregadas: ${list(names)}`,
    }),
    "agents-md": ({ rule, claudeImport }) => {
      const files = [...(rule ? ["AGENTS.md"] : []), ...(claudeImport ? ["CLAUDE.md"] : [])].join(", ");
      if (!rule)
        return {
          menu: `Agregar @AGENTS.md a CLAUDE.md, para que Claude Code lea AGENTS.md: ${files}`,
          doing: "Agregando @AGENTS.md a CLAUDE.md…",
          done: "@AGENTS.md agregado a CLAUDE.md: Claude Code lee AGENTS.md",
        };
      const also = claudeImport ? " (y @AGENTS.md en CLAUDE.md)" : "";
      return {
        menu: `Agregar a AGENTS.md la regla de versiones instaladas${also}: ${files}`,
        doing: `Agregando a AGENTS.md la regla de versiones instaladas${also}…`,
        done: `Regla de versiones instaladas agregada a AGENTS.md${also}`,
      };
    },
    "install-deps": ({ manager }) => ({
      menu: `Instalar las dependencias con ${manager}`,
      doing: `Instalando las dependencias con ${manager}…`,
      done: `Dependencias instaladas con ${manager}`,
    }),
  },
  fresh: " (nueva)",
  failed: (menu) => `Falló: ${menu}`,
  duration: (ms) => {
    if (ms < 10_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
    const seconds = Math.round(ms / 1000);
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min${seconds % 60 === 0 ? "" : ` ${seconds % 60} s`}`;
  },
  still: (elapsed) => `  … sigue (${elapsed})`,
  checking: "Revisando el repo y las últimas versiones…",
  upToDate: "Todo al día: no hay nada que instalar ni actualizar.",
  allSet: "Todo al día.",
  onlyOptional: (menus) => `Opcional, para elegir en una terminal: ${menus.join("; ")}.`,
  suggested: (dryRun) => `Pasos sugeridos${dryRun ? "" : " (para hacerlos, corre agent-kitchen apply en una terminal, o con --yes)"}:`,
  summary: (failed) => (failed.length === 0 ? "Listo." : `Terminó, pero fallaron: ${failed.join("; ")}.`),
  next: (failedInstall) => `Falta: ${failedInstall === null ? "" : `corre '${failedInstall} install', `}revisa el diff y haz commit.`,
  cloudNext: "Siguiente paso para la nube:",
  undecided: (names) => `Pieza nueva sin decisión: ${list(names)}. Corre agent-kitchen apply en una terminal para elegir.`,
  ownSkillsKept: (names) => `Se dejan fuera las skills que el repo ya tiene como propias: ${list(names)}. Para reemplazarlas, corre agent-kitchen apply en una terminal.`,
  saved: (file, commits) => `Guardé qué piezas usa el repo en ${file}${commits ? "" : "; commitéalo"}.`,
  noSteps: (why, wrote) => {
    if (why === "leave") return wrote ? "No corrí ningún paso; solo guardé qué piezas usa el repo." : "No se cambió nada.";
    return wrote ? "No elegiste pasos; solo guardé qué piezas usa el repo." : "No elegiste nada; no se cambió nada.";
  },
  nothingChanged: "No se cambió nada.",
  cloning: (base) => `Trabajo en una copia temporal de origin/${base}; tu rama y tus archivos no se tocan.`,
  changes: "Cambios del PR:",
  noChanges: "No cambió ningún archivo: no hay PR que abrir.",
  prNotOpened: (why, clone) => {
    const reason = { step: "No abrí el PR porque algún paso falló.", install: "No abrí el PR porque falló el install.", git: "" }[why];
    return `${reason === "" ? "" : `${reason} `}Los cambios quedan en la copia temporal ${clone}; bórrala con rm -rf cuando termines.`;
  },
  status: {
    heading: "Este repo tiene:",
    offByRepo: "fuera por decisión del repo",
    changePieces: (file) => `Para cambiar qué piezas usa el repo: agent-kitchen apply --pieces (o edita ${file}).`,
  },
  here: {
    dirty: (changed) => `ya tienes cambios sin commit (${changed.length === 1 ? changed[0] : `${changed.length} archivos`}); los de apply se mezclarán con ellos.`,
    behind: (commits) => `tu rama está ${commits} ${commits === 1 ? "commit" : "commits"} atrás de origin, según el último fetch; corre git pull antes, o usa --pr.`,
  },
  cli: {
    usage: (pieces) => `Uso:
  agent-kitchen apply [--yes | --dry-run] [--pr | --here] [--verbose] [--skip <pieza>,...]
  agent-kitchen apply --pieces [--pr | --here]
  agent-kitchen doctor

agent-kitchen revisa cada pieza de las herramientas de agentes del repo (${pieces.join(", ")}),
muestra qué tiene el repo y la última versión de cada una, y apply ofrece instalar lo que falta
y actualizar lo que está atrasado. En una terminal pregunta una vez: hacer todo lo sugerido,
o elegir los pasos y las skills. --yes hace lo sugerido sin preguntar; sin terminal solo lo
muestra. --verbose muestra la salida de cada herramienta.
--pr trabaja en una copia temporal de origin/<base> recién bajada, sin tocar tu rama: instala
las dependencias, hace el commit, sube una rama nueva a origin y abre un PR en draft. --here
trabaja en la rama actual y deja los cambios sin commit; si los pasos cambiaron package.json, corre
el install. En una terminal, sin ninguna de las dos, pregunta; con --yes o sin terminal, usa
--here. apply --pieces elige qué piezas usa el repo y lo guarda en .agents/kitchen.json
(en una terminal, sin --yes ni --dry-run). Córrelo en la copia principal del
repo, desde tu terminal. Sin subcomando hace lo mismo que apply, por ahora.

doctor corre las revisiones de cada pieza en la versión del repo, sin cambiar nada.

Idioma: --lang es|en, o la variable AGENT_KITCHEN_LANG; por defecto, español. El commit y el PR
de --pr quedan siempre en español.`,
    handOver: (latest, own) => `agent-kitchen: uso ${latest}, la última (esta es ${own}).`,
    noCommand: (words) => `no existe el comando ${words}.`,
    doctorNoOptions: "doctor no lleva opciones, salvo --lang.",
    commitGone: "--commit ya no existe: usa --pr para abrir un PR desde una copia de origin, o --here para dejar los cambios sin commit en la rama actual.",
    bare: "agent-kitchen: usa 'agent-kitchen apply'; sin subcomando dejará de instalar en una versión mayor.",
    lang: (source, value) => `${source} espera es o en: ${value}`,
    unknownPiece: (name, all) => `no existe la pieza ${name}; son ${all.join(", ")}.`,
    yesAndDryRun: "usa --yes o --dry-run, no los dos.",
    prAndHere: "usa --pr o --here, no los dos.",
    piecesAlone: "usa --pieces solo, sin --yes ni --dry-run.",
    piecesNeedsTerminal: "--pieces pregunta qué piezas usa el repo; córrelo en una terminal.",
    prNeedsOrigin: "--pr necesita un remoto origin, y este repo no tiene. Usa --here.",
    stopped: "No pude seguir",
  },
  menu: {
    keys: { move: "moverse", mark: "marcar", next: "seguir", choose: "elegir", space: "Espacio:" },
    whatNow: "¿Qué hago?",
    all: (count) => `Todo lo sugerido (${count} ${count === 1 ? "paso" : "pasos"})`,
    recommended: "recomendado",
    pick: "Elegir qué hacer",
    leave: "Salir sin cambiar nada",
    whichSteps: "¿Qué pasos hago?",
    whichPieces: "¿Qué piezas usa este repo?",
    whichSkills: "¿Qué skills instalo?",
    replace: (own) => `El repo ya tiene su propia versión de: ${own.join(", ")}. ¿Las reemplazo por las del catálogo? Su project.md se conserva.`,
    replaceYes: "Sí, reemplazar",
    replaceNo: "No, dejarlas fuera",
    where: "¿Dónde aplico los cambios?",
    inPr: "En un PR nuevo",
    inPrHint: (base) => `recomendado · parte de origin/${base}, no toca tu rama ni tus archivos`,
    inHere: "En la rama actual, sin commit",
    inHereHint: "los revisas con git diff y haces commit tú",
  },
  doctor: {
    allOk: "Ninguna revisión falló.",
    failed: (count) => (count === 1 ? "Falló 1 revisión." : `Fallaron ${count} revisiones.`),
  },
  repo: {
    outside: (command) => `corre ${command} dentro del repo.`,
    worktree: (command, main) => `corre ${command} en la copia principal, ${main}, no en un worktree.`,
    badJson: (path, why) => `${path} no es JSON válido (${why}); arréglalo y corre otra vez.`,
    notObject: (path) => `${path} no es un objeto JSON; arréglalo y corre otra vez.`,
    noPackage: "no hay package.json.",
    notBoolean: (file, name) => `${file}: "${name}" no es true ni false; se trata como sin decisión.`,
  },
  pr: {
    noOrigin: "--pr necesita un remoto origin, y este repo no tiene.",
    gitStatus: (error) => `no pude leer git status: ${error}`,
    fetch: "no pude bajar origin con git fetch; revisa la conexión o las credenciales y corre otra vez.",
    noBranch: (base) => `origin no tiene la rama ${base}.`,
    clone: (error) => `no pude preparar la copia temporal: ${error}`,
    noRestVersion: (name) => `no sé qué versión de ${name} usar.`,
    restSilent: "github-rest falló sin decir por qué.",
    commit: "No pude hacer el commit.",
    push: (branch) => `No pude subir la rama ${branch} a origin.`,
    open: (branch, error) => `La rama ${branch} está en origin, pero no pude abrir el PR: ${error}`,
    byHand: "Para abrirlo a mano:",
    opened: "PR en draft abierto.",
  },
  pieces: {
    common: {
      notInstalled: "no instalado",
      upToDate: (version) => `${version}, al día`,
      behind: (version, latest) => `${version}, hay ${latest}`,
      npmDown: " (npm no responde)",
      notExactKept: (spec) => `package.json tiene ${spec}, no una versión exacta; no se toca`,
      notExact: (spec) => `package.json tiene ${spec}, no una versión exacta`,
      inPackage: (name, version) => `${name} ${version} en package.json`,
      alreadyFine: "package.json ya tenía una versión que sirve",
      failed: (what, command) => `${what} falló; corre '${command}'.`,
      doctorFailed: (command) => `no se pudo correr su doctor; corre '${command}'`,
      behindRun: (version, latest) => `${version}, hay ${latest}: corre npx agent-kitchen apply`,
    },
    skillsManager: {
      summary: "el CLI de las skills, que corre agent-kitchen",
      noPackage: "no hay package.json",
      missing: "no está en package.json",
      below: (version, minimum) => `${version}, bajo ${minimum}`,
      rangeKept: (spec, runs, minimum) => `package.json tiene ${spec}, no una versión exacta; no se toca${runs === null ? "" : `; corre ${runs}, bajo ${minimum}`}`,
      checkMissing: (minimum) => `no está en package.json; corre npx agent-kitchen apply para fijar ${minimum}`,
      checkBelow: (version, minimum) => `${version}, bajo ${minimum}, el mínimo de agent-kitchen: corre npx agent-kitchen apply`,
      checkOk: (version, minimum) => `${version} (mínimo ${minimum})`,
      checkRangeBelow: (spec, runs, minimum) => `${spec} corre ${runs}, bajo ${minimum}, el mínimo de agent-kitchen: sube el rango`,
      checkRange: (spec, runs) => `${spec}${runs === null ? "" : `, corre ${runs}`}`,
    },
    flow: {
      summary: "rama, worktree y PR en draft por issue",
      labelsUnread: " (no se pudieron leer los labels de GitHub)",
      skillAt: (name, tag) => `${name} en ${tag ?? "sin tag"}`,
      catalogAt: (ref) => `el catálogo en ${ref ?? "la última"}`,
      skillsMoved: (version, names) => `skills del flujo en v${version}: ${list(names)}`,
      skillsFailed: (command) => `skills-manager no actualizó las skills del flujo; corre '${command}' y luego agent-kitchen apply otra vez.`,
      silent: (command) => `issue-flow apply no dijo qué hizo; corre '${command}'.`,
      labelsSkipped: (version) => `no se crearon: el repo no tiene issue-flow ${version}`,
      restSkipped: (version) => `no se subió: el repo no tiene issue-flow ${version}`,
      noJsonDoctor: (version) => `${version} no tiene doctor --json: corre npx agent-kitchen apply para actualizarlo`,
      noSkills: "ninguna instalada",
      skillsAt: (count, version) => `${count} en v${version}`,
      skillsBehind: (off, version) => `${list(off)}; issue-flow está en ${version}: corre npx agent-kitchen apply`,
      labelsCheckUnread: "no se pudieron leer de GitHub",
      labelsMissing: (missing) => `faltan ${list(missing)} en GitHub; corre npx agent-kitchen apply`,
      labelsOk: "GitHub tiene los que espera el flujo",
    },
    cloud: {
      summary: "sesiones en la nube de Claude",
      unpinned: (config) => `${config} no fija versión`,
      checkUnpinned: (config, example) => `${config} no fija una versión exacta: pon en "version" la que se usa, como "${example}"`,
    },
    guard: {
      summary: "barandas: modo auto con sandbox",
      sandbox: (command) => `claude-repo-guard no se instaló: no tuvo permiso para escribir en el repo. Si corres agent-kitchen dentro de una sesión de Claude, su sandbox bloquea .claude/settings.json; corre '${command}' desde tu terminal.`,
      failed: (command) => `claude-repo-guard no se instaló; su error está abajo. Para reintentar a mano: '${command}'.`,
      explainsFlow: "le explica el flujo de issues al modo auto",
      integration: (branch) => `rama de integración ${branch}`,
      weaker: (option) => `${option} activado, para que gh funcione en el sandbox de macOS`,
      optionsFine: "sus opciones ya tienen lo que necesita el flujo",
      noTag: " (GitHub no tiene una versión)",
      unknown: "versión desconocida",
      checkNotInstalled: "no instalado (Claude se abre con tus propios permisos)",
      checkWeaker: (config) => `no está activado en ${config}, así que gh falla en el sandbox de macOS: corre npx agent-kitchen apply`,
      checkOk: (version) => `${version}, su doctor pasa`,
    },
    skills: {
      summary: "skills del flujo, planes y auditorías",
      notInstalled: "no instaladas",
      catalogsUnread: " (no se pudieron leer los catálogos)",
      installed: (count, behind) => `${count} instaladas${behind ? ", algunas atrasadas" : ", al día"}`,
      withoutFlow: "sin las skills del flujo, porque issue-flow no está instalado",
      none: "ninguna skill que instalar",
      count: (count) => `${count} skills`,
      replaced: (names) => `reemplazadas (con su project.md): ${list(names)}`,
      installFailed: (command) => `skills-manager no instaló las skills; corre '${command}'.`,
      updateFailed: (catalog, command) => `skills-manager no actualizó ${catalog}; corre '${command}' y luego agent-kitchen apply otra vez.`,
      checkOk: "skills-manager check pasa",
      checkFailed: (command) => `el disco, el lock y el manifiesto no coinciden: corre '${command}'`,
    },
    agentsMd: {
      summary: "regla de versiones instaladas en AGENTS.md",
      upToDate: "al día",
      noRule: "falta la regla",
      noImport: "CLAUDE.md no importa AGENTS.md",
      noPackage: "sin package.json: no se agregó nada",
      checkNoRule: "falta la regla de versiones en AGENTS.md; corre npx agent-kitchen apply",
      checkNoImport: "CLAUDE.md no importa AGENTS.md, así que Claude Code no lo lee; corre npx agent-kitchen apply",
      checkOk: "regla de versiones en AGENTS.md",
    },
  },
};
