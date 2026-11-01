/**
 * @file The interface's texts, and how a step reads in a list. Another language is a file
 * like es.ts that implements `Catalog`, chosen here.
 */
import type { Step } from "../piece.js";
import type { Catalog, StepPhrases } from "./catalog.js";
import { es } from "./es.js";
import type { StepKind, StepOf, StepText } from "./step-text.js";

/** The catalog the interface uses. */
export const ui: Catalog = es;

/**
 * A step's texts in a catalog.
 * @param catalog - The catalog.
 * @param text - What the step does.
 * @returns Its texts.
 * @example phrasesIn(es, { kind: "guard-adjust" }).doing // "Ajustando claude-repo-guard al flujo de issues…"
 */
export function phrasesIn(catalog: Catalog, text: StepText): StepPhrases {
  const render = catalog.steps[text.kind] as (step: StepOf<StepKind>) => StepPhrases;
  return render(text);
}

/**
 * A step's texts in the interface.
 * @param text - What the step does.
 * @returns Its texts.
 */
export function phrases(text: StepText): StepPhrases {
  return phrasesIn(ui, text);
}

/**
 * How a step reads in the menu and in lists: its order, marked if its piece is new.
 * @param step - The step.
 * @returns The text.
 * @example stepLabel(step) // "Actualizar issue-flow 0.2.7 → 0.3.0, con sus hooks y sus skills"
 */
export function stepLabel(step: Pick<Step, "text" | "fresh">): string {
  return `${phrases(step.text).menu}${step.fresh === true ? ui.fresh : ""}`;
}
