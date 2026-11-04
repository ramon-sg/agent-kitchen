/**
 * @file The shape of a catalog of the texts the person sees in the terminal. Every language
 * implements `Catalog`; the compiler then asks for every kind of step and every message, and a
 * test checks that the catalogs have the same keys. The interface uses `ui`; the commit, the PR
 * and what is written into the repo's files do not (see commit-texts.ts).
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

/** The texts the pieces share: their states, notes and checks. */
export interface PieceTexts {
  notInstalled: string;
  /** A version that is the latest: "1.2.0, al día". */
  upToDate: (version: string) => string;
  /** A version with a newer one: "1.1.0, hay 1.2.0". */
  behind: (version: string, latest: string) => string;
  /** Added to a state when npm did not answer. */
  npmDown: string;
  /** A version in package.json that is not exact, which the piece leaves alone. */
  notExactKept: (spec: string) => string;
  /** The same, in doctor. */
  notExact: (spec: string) => string;
  /** A package written into package.json. */
  inPackage: (name: string, version: string) => string;
  alreadyFine: string;
  /** A tool that failed, with the command to run by hand. */
  failed: (what: string, command: string) => string;
  /** A tool's doctor that could not run, with the command to run by hand. */
  doctorFailed: (command: string) => string;
  /** A newer version, in doctor. */
  behindRun: (version: string, latest: string) => string;
}

/** Every text the person sees. */
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
  /** With --yes and nothing suggested: the title. */
  allSet: string;
  /** With --yes and nothing suggested: the optional steps. */
  onlyOptional: (menus: string[]) => string;
  /** The heading of the steps listed without running them. */
  suggested: (dryRun: boolean) => string;
  /** The title of the end when every step worked or some failed. */
  summary: (failed: string[]) => string;
  /** What is left to do by hand after the steps, in the checkout; with the manager if its install failed. */
  next: (failedInstall: string | null) => string;
  /** The label of the step after apply when agent-cloud-kit is installed. */
  cloudNext: string;
  /** A new piece left out because no one was asked about it. */
  undecided: (names: string[]) => string;
  /** The repo's own skills left out of a pick. */
  ownSkillsKept: (names: string[]) => string;
  /** The decisions were saved. */
  saved: (file: string, commits: boolean) => string;
  /** The closing line when no step ran: the person left, or picked none. */
  noSteps: (why: "leave" | "none", wrote: boolean) => string;
  /** Nothing was changed. */
  nothingChanged: string;
  /** With --pr, before the clone: from which branch of origin. */
  cloning: (base: string) => string;
  /** With --pr, the heading of the files that go in the PR. */
  changes: string;
  /** With --pr, nothing changed. */
  noChanges: string;
  /** With --pr, why no PR was opened and where the changes stay. */
  prNotOpened: (why: "step" | "install" | "git", clone: string) => string;
  /** The table of what the repo has. */
  status: {
    heading: string;
    /** A piece the repo left out in `.agents/kitchen.json`. */
    offByRepo: string;
    /** How to change which pieces the repo uses. */
    changePieces: (file: string) => string;
  };
  /** The warnings before working in the checkout. */
  here: {
    dirty: (changed: string[]) => string;
    behind: (commits: number) => string;
  };
  /** The command line: its help, its errors and its warnings. */
  cli: {
    usage: (pieces: string[]) => string;
    /** A newer agent-kitchen on npm runs instead of this one. */
    handOver: (latest: string, own: string) => string;
    noCommand: (words: string) => string;
    doctorNoOptions: string;
    commitGone: string;
    /** `agent-kitchen` without a subcommand. */
    bare: string;
    lang: (source: string, value: string) => string;
    unknownPiece: (name: string, all: string[]) => string;
    yesAndDryRun: string;
    prAndHere: string;
    piecesAlone: string;
    piecesNeedsTerminal: string;
    prNeedsOrigin: string;
    /** The title of the block of an error that stops the command. */
    stopped: string;
  };
  /** The questions. */
  menu: {
    /** The keys' help under a menu of checkboxes and under a menu of one choice. */
    keys: { move: string; mark: string; next: string; choose: string; space: string };
    whatNow: string;
    all: (count: number) => string;
    recommended: string;
    pick: string;
    leave: string;
    whichSteps: string;
    whichPieces: string;
    whichSkills: string;
    replace: (own: string[]) => string;
    replaceYes: string;
    replaceNo: string;
    where: string;
    inPr: string;
    inPrHint: (base: string) => string;
    inHere: string;
    inHereHint: string;
  };
  /** The end of doctor. */
  doctor: {
    allOk: string;
    failed: (count: number) => string;
  };
  /** The repo and its files. */
  repo: {
    outside: (command: string) => string;
    worktree: (command: string, main: string) => string;
    badJson: (path: string, why: string) => string;
    notObject: (path: string) => string;
    noPackage: string;
    /** A decision in `.agents/kitchen.json` that is not true nor false. */
    notBoolean: (file: string, name: string) => string;
  };
  /** The clone, the commit, the push and the PR of `--pr`. */
  pr: {
    noOrigin: string;
    gitStatus: (error: string) => string;
    fetch: string;
    noBranch: (base: string) => string;
    clone: (error: string) => string;
    noRestVersion: (name: string) => string;
    restSilent: string;
    commit: string;
    push: (branch: string) => string;
    open: (branch: string, error: string) => string;
    byHand: string;
    opened: string;
  };
  /** What the pieces say. */
  pieces: {
    common: PieceTexts;
    skillsManager: {
      summary: string;
      noPackage: string;
      missing: string;
      below: (version: string, minimum: string) => string;
      /** A range left alone, and the version it runs if that is below the minimum. */
      rangeKept: (spec: string, runs: string | null, minimum: string) => string;
      checkMissing: (minimum: string) => string;
      checkBelow: (version: string, minimum: string) => string;
      checkOk: (version: string, minimum: string) => string;
      checkRangeBelow: (spec: string, runs: string, minimum: string) => string;
      checkRange: (spec: string, runs: string | null) => string;
    };
    flow: {
      summary: string;
      labelsUnread: string;
      skillAt: (name: string, tag: string | null) => string;
      catalogAt: (ref: string | null) => string;
      skillsMoved: (version: string, names: string[]) => string;
      skillsFailed: (command: string) => string;
      silent: (command: string) => string;
      labelsSkipped: (version: string) => string;
      restSkipped: (version: string) => string;
      noJsonDoctor: (version: string) => string;
      noSkills: string;
      skillsAt: (count: number, version: string) => string;
      skillsBehind: (off: string[], version: string) => string;
      labelsCheckUnread: string;
      labelsMissing: (missing: string[]) => string;
      labelsOk: string;
    };
    cloud: {
      summary: string;
      unpinned: (config: string) => string;
      checkUnpinned: (config: string, example: string) => string;
    };
    guard: {
      summary: string;
      sandbox: (command: string) => string;
      failed: (command: string) => string;
      explainsFlow: string;
      integration: (branch: string) => string;
      weaker: (option: string) => string;
      optionsFine: string;
      noTag: string;
      unknown: string;
      checkNotInstalled: string;
      checkWeaker: (config: string) => string;
      checkOk: (version: string) => string;
    };
    skills: {
      summary: string;
      notInstalled: string;
      catalogsUnread: string;
      installed: (count: number, behind: boolean) => string;
      withoutFlow: string;
      none: string;
      count: (count: number) => string;
      replaced: (names: string[]) => string;
      installFailed: (command: string) => string;
      updateFailed: (catalog: string, command: string) => string;
      checkOk: string;
      checkFailed: (command: string) => string;
    };
    agentsMd: {
      summary: string;
      upToDate: string;
      noRule: string;
      noImport: string;
      noPackage: string;
      checkNoRule: string;
      checkNoImport: string;
      checkOk: string;
    };
  };
}
