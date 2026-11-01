/**
 * @file The shape of a catalog of the texts the person sees while `apply` runs its steps.
 * Every language implements `Catalog`; the compiler then asks for every kind of step and every
 * message. The interface uses `ui`; the commit and the PR do not (see commit-texts.ts).
 */
import type { StepKind, StepOf } from "./step-text.js";

/** One step's texts, one per place it shows. */
export interface StepPhrases {
  /** In the menu and the lists of steps, as an order: "Actualizar issue-flow 0.2.7 → 0.3.0". */
  menu: string;
  /** While it runs: "Actualizando issue-flow de 0.2.7 a 0.3.0…". */
  doing: string;
  /** When it worked, saying what is left: "issue-flow actualizado de 0.2.7 a 0.3.0". */
  done: string;
}

/** Every text of `apply` around its steps. */
export interface Catalog {
  /** Each kind of step's texts. */
  steps: { [K in StepKind]: (step: StepOf<K>) => StepPhrases };
  /** Added to a step of a piece the repo has not decided on yet. */
  fresh: string;
  /** The end line of a step that failed, from its menu text. */
  failed: (menu: string) => string;
  /** A duration, short: "0,4 s", "12 s", "1 min 5 s". */
  duration: (ms: number) => string;
  /** The line a long step prints while it runs, so it does not look stuck. */
  still: (elapsed: string) => string;
  /** The line before looking at the pieces. */
  checking: string;
  /** Nothing to install or update. */
  upToDate: string;
  /** With --yes and nothing suggested: the optional steps. */
  onlyOptional: (menus: string[]) => string;
  /** The heading of the steps listed without running them. */
  suggested: (dryRun: boolean) => string;
  /** The last line when every step worked or some failed. */
  summary: (failed: string[]) => string;
  /** What is left to do by hand after the steps, without --commit; with the manager if its install failed. */
  next: (failedInstall: string | null) => string;
  /** A new piece left out because no one was asked about it. */
  undecided: (names: string[]) => string;
  /** The repo's own skills left out of a pick. */
  ownSkillsKept: (names: string[]) => string;
  /** The decisions were saved. */
  saved: (file: string, commits: boolean) => string;
  /** The closing line when no step ran: the person left, or picked none. */
  noSteps: (why: "leave" | "none", wrote: boolean) => string;
}
