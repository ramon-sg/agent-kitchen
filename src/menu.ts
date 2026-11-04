/**
 * @file The questions, in the interface's language (`@clack/prompts`), all asked before any step runs: where to
 * apply (a PR or the checkout), the quick path (do everything suggested, pick, or leave), the
 * checkbox menu of the steps, the skills of a step grouped by catalog with their description,
 * and whether to replace the repo's own skills. They only run with a terminal.
 */
import { styleText } from "node:util";
import { confirm, groupMultiselect, isCancel, MULTISELECT_INSTRUCTIONS, multiselect, select, SELECT_INSTRUCTIONS } from "@clack/prompts";
import type { Candidate, Step } from "./piece.js";
import { stepLabel, ui } from "./texts/index.js";

/** What the person wants after seeing the table. */
export type Path = "all" | "pick" | "leave";

/** Width a skill's description is cut to in the menu. */
const DESCRIPTION_WIDTH = 70;

/**
 * Puts the keys' help of the menus in the interface's language. The library exports those
 * lines as arrays, so they are replaced in place.
 */
function localKeys(): void {
  const keys = ui.menu.keys;
  MULTISELECT_INSTRUCTIONS.splice(0, MULTISELECT_INSTRUCTIONS.length, `${styleText("dim", "↑/↓")} ${keys.move}`, `${styleText("dim", keys.space)} ${keys.mark}`, `${styleText("dim", "Enter:")} ${keys.next}`);
  SELECT_INSTRUCTIONS.splice(0, SELECT_INSTRUCTIONS.length, `${styleText("dim", "↑/↓")} ${keys.move}`, `${styleText("dim", "Enter:")} ${keys.choose}`);
}

/**
 * The menu's options: each step's index and label, which names its piece.
 * @param steps - The steps.
 * @returns The options and the ones ticked at the start.
 * @example menuOptions(steps).initialValues // [0, 1]
 */
export function menuOptions(steps: Step[]): { options: { value: number; label: string }[]; initialValues: number[] } {
  return {
    options: steps.map((step, index) => ({ value: index, label: stepLabel(step) })),
    initialValues: steps.flatMap((step, index) => (step.checked ? [index] : [])),
  };
}

/**
 * The pieces menu's options: each piece by its name, ticked if the repo uses it.
 * @param names - The pieces, in the order to show them.
 * @param ticked - The ones ticked at the start.
 * @returns The options and the ones ticked at the start.
 * @example pieceOptions(["issue-flow", "skills"], ["skills"]).initialValues // ["skills"]
 */
export function pieceOptions(names: string[], ticked: string[]): { options: { value: string; label: string }[]; initialValues: string[] } {
  return { options: names.map((name) => ({ value: name, label: name })), initialValues: names.filter((name) => ticked.includes(name)) };
}

/**
 * The skills menu's options: grouped by catalog, each with its description cut short.
 * @param candidates - What the catalogs offer.
 * @returns The groups.
 * @example Object.keys(skillOptions(candidates)) // ["ramon-sg/issue-flow", "ramon-sg/agent-skills"]
 */
export function skillOptions(candidates: Candidate[]): Record<string, { value: string; label: string; hint?: string }[]> {
  const groups: Record<string, { value: string; label: string; hint?: string }[]> = {};
  for (const candidate of candidates) {
    const hint = candidate.description.length > DESCRIPTION_WIDTH ? `${candidate.description.slice(0, DESCRIPTION_WIDTH - 1)}…` : candidate.description;
    const group = candidate.catalog === "" ? "skills" : candidate.catalog;
    groups[group] = [...(groups[group] ?? []), { value: candidate.id, label: candidate.name, ...(hint === "" ? {} : { hint }) }];
  }
  return groups;
}

/**
 * Asks what to do: everything suggested, pick step by step, or leave.
 * @param count - How many steps are suggested; with none, the option to do them is not shown.
 * @returns The answer; "leave" if the person cancelled.
 * @example await askPath(4) // "all"
 */
export async function askPath(count: number): Promise<Path> {
  localKeys();
  const all = { value: "all" as const, label: ui.menu.all(count), hint: ui.menu.recommended };
  const answer = await select<Path>({
    message: ui.menu.whatNow,
    options: [...(count === 0 ? [] : [all]), { value: "pick", label: ui.menu.pick }, { value: "leave", label: ui.menu.leave }],
  });
  return isCancel(answer) ? "leave" : answer;
}

/**
 * Asks which steps to run.
 * @param steps - The steps.
 * @returns The picked ones, in their order, or null if the person cancelled.
 * @example await askSteps(steps)
 */
export async function askSteps(steps: Step[]): Promise<Step[] | null> {
  localKeys();
  const { options, initialValues } = menuOptions(steps);
  const picked = await multiselect({ message: ui.menu.whichSteps, options, initialValues, required: false });
  if (isCancel(picked)) return null;
  return steps.filter((_, index) => picked.includes(index));
}

/**
 * Asks which pieces the repo uses.
 * @param names - The pieces.
 * @param ticked - The ones ticked at the start.
 * @returns The picked pieces, or null if the person cancelled.
 * @example await askPieces(["issue-flow", "skills"], ["skills"])
 */
export async function askPieces(names: string[], ticked: string[]): Promise<string[] | null> {
  localKeys();
  const { options, initialValues } = pieceOptions(names, ticked);
  const picked = await multiselect({ message: ui.menu.whichPieces, options, initialValues, required: false });
  return isCancel(picked) ? null : picked;
}

/**
 * Asks which skills to install.
 * @param candidates - What the catalogs offer.
 * @param ticked - The ids ticked at the start.
 * @returns The picked ids, or null if the person cancelled.
 * @example await askSkills(candidates, ["catalog:ramon-sg/agent-skills/planning"])
 */
export async function askSkills(candidates: Candidate[], ticked: string[]): Promise<string[] | null> {
  localKeys();
  const picked = await groupMultiselect({ message: ui.menu.whichSkills, options: skillOptions(candidates), initialValues: ticked, required: false });
  return isCancel(picked) ? null : picked;
}

/**
 * Asks whether the catalog's skills replace the repo's own ones with the same name.
 * @param own - Their names.
 * @returns True to replace them, false to keep them, or null if the person cancelled.
 * @example await askReplace(["planning"])
 */
export async function askReplace(own: string[]): Promise<boolean | null> {
  const answer = await confirm({
    message: ui.menu.replace(own),
    active: ui.menu.replaceYes,
    inactive: ui.menu.replaceNo,
  });
  return isCancel(answer) ? null : answer;
}

/** Where apply works: a PR from a clone of origin, or the person's checkout. */
export type Place = "pr" | "here";

/**
 * Asks, before anything else, where to apply the changes.
 * @param base - The base branch.
 * @returns The answer, or null if the person cancelled.
 * @example await askPlace("main") // "pr"
 */
export async function askPlace(base: string): Promise<Place | null> {
  localKeys();
  const answer = await select<Place>({
    message: ui.menu.where,
    initialValue: "pr",
    options: [
      { value: "pr", label: ui.menu.inPr, hint: ui.menu.inPrHint(base) },
      { value: "here", label: ui.menu.inHere, hint: ui.menu.inHereHint },
    ],
  });
  return isCancel(answer) ? null : answer;
}
