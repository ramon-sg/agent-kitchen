/**
 * @file What the repo wants of each piece, kept in `.agents/kitchen.json`: `true` to have it,
 * `false` to leave it out for good. Only the pieces that are a choice carry a decision;
 * `skills-manager` does not, because it is the tool that installs the others' skills and is
 * always kept up to date, never opted in or out.
 */
import { isObject, readJson, writeJson } from "./repo.js";
import type { PieceStatus, Step } from "./piece.js";
import { NAME as AGENTS_MD } from "./pieces/agents-md.js";
import { NAME as CLOUD } from "./pieces/cloud.js";
import { NAME as GUARD } from "./pieces/guard.js";
import { NAME as ISSUE_FLOW } from "./pieces/issue-flow.js";
import { NAME as SKILLS } from "./pieces/skills.js";

/** The file with the decisions, relative to the repo. */
export const DECISIONS = ".agents/kitchen.json";

/** The pieces a repo can decide on, in the order sync runs them. */
export const DECIDABLE: string[] = [ISSUE_FLOW, CLOUD, GUARD, SKILLS, AGENTS_MD];

/** What was read from the decisions file. */
export interface Saved {
  /** The valid decisions of the decidable pieces. */
  pieces: Record<string, boolean>;
  /** The whole file, to write back without losing what is not ours. */
  raw: Record<string, unknown>;
  /** What was wrong in the file, in Spanish, for the user. */
  warnings: string[];
}

/**
 * Reads the decisions of a repo.
 * @param root - The repo.
 * @returns The decisions, or null if the file does not exist.
 * @throws KitError if the file is not valid JSON.
 * @example readDecisions(root)?.pieces // { "claude-repo-guard": false }
 */
export function readDecisions(root: string): Saved | null {
  const raw = readJson(root, DECISIONS);
  if (raw === null) return null;
  const stored = isObject(raw.pieces) ? raw.pieces : {};
  const pieces: Record<string, boolean> = {};
  const warnings: string[] = [];
  for (const name of DECIDABLE) {
    if (!(name in stored)) continue;
    const value = stored[name];
    if (typeof value === "boolean") pieces[name] = value;
    else warnings.push(`${DECISIONS}: "${name}" no es true ni false; se trata como sin decisión.`);
  }
  return { pieces, raw, warnings };
}

/**
 * The decidable pieces with no decision yet.
 * @param saved - What was read, or null if there is no file.
 * @returns Their names; all of them without a file.
 * @example undecided(null) // ["issue-flow", "claude-cloud", ...]
 */
export function undecided(saved: Saved | null): string[] {
  return DECIDABLE.filter((name) => saved?.pieces[name] === undefined);
}

/**
 * The pieces the repo decided not to have.
 * @param saved - What was read, or null if there is no file.
 * @returns Their names.
 * @example off({ pieces: { skills: false }, raw: {}, warnings: [] }) // ["skills"]
 */
export function off(saved: Saved | null): string[] {
  return DECIDABLE.filter((name) => saved?.pieces[name] === false);
}

/**
 * Settles the pieces that have no decision from what the repo has and what was chosen.
 * @param statuses - What each piece found.
 * @param chosen - The steps the user picked.
 * @param previous - The decisions already made; they never change here.
 * @returns `previous` plus a decision for each decidable piece without one: installed or
 * with a chosen step is true, offered steps all unchosen is false, no steps leaves it open.
 * @example decide([{ name: "skills", installed: true, summary: "", state: "", steps: [] }], [], {}) // { skills: true }
 */
export function decide(statuses: PieceStatus[], chosen: Step[], previous: Record<string, boolean>): Record<string, boolean> {
  const result = { ...previous };
  for (const status of statuses) {
    if (!DECIDABLE.includes(status.name) || status.name in previous) continue;
    if (status.installed || chosen.some((step) => step.piece === status.name)) result[status.name] = true;
    else if (status.steps.length > 0) result[status.name] = false;
  }
  return result;
}

/**
 * Writes the decisions, keeping every other key of the file.
 * @param root - The repo.
 * @param pieces - The decisions to write.
 * @param raw - The whole file as it was read (empty if there was none).
 * @example writeDecisions(root, { "issue-flow": true }, {})
 */
export function writeDecisions(root: string, pieces: Record<string, boolean>, raw: Record<string, unknown>): void {
  const rawPieces = isObject(raw.pieces) ? raw.pieces : {};
  writeJson(root, DECISIONS, { ...raw, pieces: { ...rawPieces, ...pieces } });
}
