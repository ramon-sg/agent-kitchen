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
      menu: `Instalar claude-cloud ${version ?? "1.x"}: prepara las sesiones en la nube de Claude`,
      doing: `Instalando claude-cloud ${version ?? "1.x"}…`,
      done: `claude-cloud ${version ?? "1.x"} instalado: prepara las sesiones en la nube de Claude`,
    }),
    "cloud-update": ({ from, to, config }) => ({
      menu: `Actualizar claude-cloud ${from ?? "?"} → ${to} (la versión que fija ${config})`,
      doing: `Actualizando claude-cloud de ${from ?? "?"} a ${to}…`,
      done: `claude-cloud actualizado de ${from ?? "?"} a ${to} en ${config}`,
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
  onlyOptional: (menus) => `Todo al día. Opcional, para elegir en una terminal: ${menus.join("; ")}.`,
  suggested: (dryRun) => `Pasos sugeridos${dryRun ? "" : " (para hacerlos, corre agent-kitchen apply en una terminal, o con --yes)"}:`,
  summary: (failed) => (failed.length === 0 ? "Listo." : `Terminó, pero fallaron: ${failed.join("; ")}.`),
  next: (failedInstall) => `Falta: ${failedInstall === null ? "" : `corre '${failedInstall} install', `}revisa el diff y haz commit.`,
  undecided: (names) => `Pieza nueva sin decisión: ${list(names)}. Corre agent-kitchen apply en una terminal para elegir.`,
  ownSkillsKept: (names) => `Se dejan fuera las skills que el repo ya tiene como propias: ${list(names)}. Para reemplazarlas, corre agent-kitchen apply en una terminal.`,
  saved: (file, commits) => `Guardé qué piezas usa el repo en ${file}${commits ? "" : "; commitéalo"}.`,
  noSteps: (why, wrote) => {
    if (why === "leave") return wrote ? "No corrí ningún paso; solo guardé qué piezas usa el repo." : "No se cambió nada.";
    return wrote ? "No elegiste pasos; solo guardé qué piezas usa el repo." : "No elegiste nada; no se cambió nada.";
  },
};
