/**
 * @file The texts of the commit and the PR of `apply --commit`. They are always in Spanish,
 * whatever language the interface shows: a repo's history should not change language with the
 * terminal of whoever ran the command. A step reads as its Spanish menu order.
 */
import { DECISIONS } from "./decisions.js";
import { es } from "./texts/es.js";
import { phrasesIn } from "./texts/index.js";
import type { StepText } from "./texts/step-text.js";

/** The subject of the commit and the title of the PR. */
export const COMMIT_TITLE = "chore: agent-kitchen apply";

/** The line of the decisions file. */
export const DECISIONS_LINE = `Guardar qué piezas usa el repo en ${DECISIONS}`;

/**
 * A step's line in the commit and the PR.
 * @param text - What the step does.
 * @returns The line, without the dash.
 * @example commitLine({ kind: "flow-install", version: "0.2.0" }) // "Instalar issue-flow 0.2.0: config del flujo, hooks y scripts"
 */
export function commitLine(text: StepText): string {
  return phrasesIn(es, text).menu;
}

/**
 * The body of the PR.
 * @param lines - What the commit lists.
 * @returns The body.
 */
export function prBody(lines: string[]): string {
  return `Cambios de \`agent-kitchen apply\`:\n\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}
