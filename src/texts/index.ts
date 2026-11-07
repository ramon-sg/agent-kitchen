/**
 * @file The interface's texts, and how a step reads in a list. Each language is a file like
 * es.ts that implements `Catalog`; the entry point picks one once with `useLang`.
 */
import type { Lang } from "../lang.js";
import type { Step } from "../piece.js";
import type { Catalog, StepPhrases } from "./catalog.js";
import { en } from "./en.js";
import { es } from "./es.js";
import type { StepKind, StepOf, StepText } from "./step-text.js";

/** The catalog the interface uses: Spanish until the entry point says otherwise. */
export let ui: Catalog = es;

/** The language picked: Spanish until the entry point says otherwise. */
let picked: Lang = "es";

/**
 * Picks the language of the interface, once, before any text is shown.
 * @param lang - The language.
 * @example useLang("en")
 */
export function useLang(lang: Lang): void {
  picked = lang;
  ui = lang === "en" ? en : es;
}

/**
 * The language of the interface, to hand to the tools agent-kitchen runs.
 * @returns The language `useLang` picked, or `es`.
 * @example currentLang() // "es"
 */
export function currentLang(): Lang {
  return picked;
}

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
