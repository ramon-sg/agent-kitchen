/**
 * @file `agent-kitchen apply [--yes] [--dry-run] [--commit] [--verbose] [--skip <piece>,...]`: the one command
 * that changes the repo (and, for now, also the bare `agent-kitchen`).
 * It looks at each piece (the version of skills-manager, the issue flow, claude-cloud,
 * claude-repo-guard, the skills, the rule in AGENTS.md) with
 * every lookup at once, shows what the repo has, and offers the steps that install what is
 * missing or update what is behind. In a terminal it asks first, all in one go: everything
 * suggested, or pick the steps and the skills; whether to replace the repo's own skills.
 * While the person answers, the tools download. Then the steps run in order (skills-manager
 * first, since the flow moves its skills with it; the skills last, since they follow the
 * flow's version), one line each, with the
 * tools' output only when one fails; one that fails does not stop the rest. With `--yes`
 * it does what is suggested without asking (and keeps the repo's own skills); without a
 * terminal it only shows the steps. With `--commit` it first checks the repo is clean and on
 * its base branch, and at the end installs if package.json changed and asks what to do with
 * the changes (see git-finish.ts), also when the only change is the decisions file below;
 * the steps then show as plain lines, since a spinner before a question leaves it deaf.
 * What the repo decided of each piece, in `.agents/kitchen.json`, is respected: a piece set to
 * false is left out as with `--skip`, and one with no decision is marked as new. Without
 * asking (`--yes` or no terminal), a new piece that is not installed is left out for the run.
 * In a terminal, once the person has answered, the pieces without a decision get one and the
 * file is written; `--yes`, `--dry-run` and `--skip` never write it.
 * `--pieces` (terminal only, not with `--yes` or `--dry-run`) first asks which pieces the repo
 * uses, writes all of them to the file, and then goes on as usual.
 */
import { DECIDABLE, decide, DECISIONS, off, readDecisions, type Saved, undecided, writeDecisions } from "../decisions.js";
import { baseBranch, branchName, changedPaths, checkReady, finish } from "../git-finish.js";
import { askFinish, askPath, askPieces, askReplace, askSkills, askSteps } from "../menu.js";
import { KitError, type Output, UsageError, warn } from "../output.js";
import type { Context, PieceStatus, Step } from "../piece.js";
import { cloudStatus, NAME as CLOUD } from "../pieces/cloud.js";
import { guardStatus, NAME as GUARD } from "../pieces/guard.js";
import { issueFlowStatus, NAME as FLOW } from "../pieces/issue-flow.js";
import { keepOwn, NAME as SKILLS, ownInPick, skillsStatus } from "../pieces/skills.js";
import { agentsMdStatus, NAME as AGENTS_MD } from "../pieces/agents-md.js";
import { NAME as SKILLS_MANAGER, skillsManagerStatus } from "../pieces/skills-manager.js";
import { mainCheckout, packageManager } from "../repo.js";
import { download, failedOutput, runInstall, setVerbose } from "../tools.js";
import { commitLine, DECISIONS_LINE } from "../commit-texts.js";
import { type Progress, progressFor } from "../progress.js";
import { stepLabel, ui } from "../texts/index.js";

/** Options of the command. */
export interface SyncOptions {
  cwd: string;
  yes: boolean;
  dryRun: boolean;
  verbose: boolean;
  skip: string[];
  commit: boolean;
  /** Ask which pieces the repo uses, save the answer, then go on as usual. */
  pieces: boolean;
}

/** Every piece, in the order its steps run. */
const PIECES = [SKILLS_MANAGER, FLOW, CLOUD, GUARD, SKILLS, AGENTS_MD];

/**
 * The names `--skip` takes.
 * @returns The pieces' names.
 * @example pieceNames() // ["skills-manager", "issue-flow", "claude-cloud", "claude-repo-guard", "skills", "agents-md"]
 */
export function pieceNames(): string[] {
  return [...PIECES];
}

/**
 * Each piece's status, with every lookup at once. skills-manager, the guard's step and the
 * rule in AGENTS.md depend on whether the flow is about to be installed (it writes
 * package.json), so they wait for the flow's status.
 * @param root - The repo.
 * @param skip - The pieces left out.
 * @returns The statuses, in the pieces' order.
 */
async function statusesOf(root: string, skip: string[]): Promise<PieceStatus[]> {
  const flow = skip.includes(FLOW) ? null : issueFlowStatus(root);
  const flowComing = (flow ?? Promise.resolve(null)).then((status) => status !== null && !status.installed && status.steps.length > 0);
  const skillsManager = skip.includes(SKILLS_MANAGER) ? null : flowComing.then((coming) => skillsManagerStatus(root, !skip.includes(SKILLS), coming));
  const cloud = skip.includes(CLOUD) ? null : cloudStatus(root);
  const skills = skip.includes(SKILLS) ? null : skillsStatus(root, !skip.includes(FLOW));
  const guard = skip.includes(GUARD) ? null : flowComing.then((coming) => guardStatus(root, coming));
  const agentsMd = skip.includes(AGENTS_MD) ? null : flowComing.then((coming) => agentsMdStatus(root, coming));
  const all = await Promise.all([skillsManager, flow, cloud, guard, skills, agentsMd]);
  return all.flatMap((status) => status ?? []);
}

/**
 * Prints what the repo has of each piece, in the pieces' order, and the pieces the repo
 * decided not to have, with how to change that.
 * @param statuses - The pieces' statuses.
 * @param decidedOff - The pieces left out by the repo's decision.
 * @param out - Where to write.
 */
function printStatus(statuses: PieceStatus[], decidedOff: string[], out: Output): void {
  const width = Math.max(...statuses.map((status) => status.name.length), ...decidedOff.map((name) => name.length));
  const stateWidth = Math.max(...statuses.map((status) => status.state.length));
  out.stdout("\nEste repo tiene:\n");
  for (const name of PIECES) {
    for (const status of statuses.filter((each) => each.name === name)) out.stdout(`  ${status.name.padEnd(width)}  ${status.state.padEnd(stateWidth)}  · ${status.summary}\n`);
    if (decidedOff.includes(name)) out.stdout(`  ${name.padEnd(width)}  fuera por decisión del repo\n`);
  }
  if (decidedOff.length > 0) out.stdout(`\nPara cambiar qué piezas usa el repo: agent-kitchen apply --pieces (o edita ${DECISIONS}).\n`);
  out.stdout("\n");
}

/**
 * Settles the pieces without a decision and writes the file, unless nothing changed or
 * nothing was decided.
 * @param root - The repo.
 * @param saved - What was read, or null if there is no file.
 * @param statuses - What each piece found.
 * @param chosen - The steps the person picked.
 * @param commits - Whether `--commit` asks about the changes at the end.
 * @param out - Where to write.
 * @returns True if the file was written.
 */
function saveDecisions(root: string, saved: Saved | null, statuses: PieceStatus[], chosen: Step[], commits: boolean, out: Output): boolean {
  const previous = saved?.pieces ?? {};
  const pieces = decide(statuses, chosen, previous);
  const same = Object.keys(pieces).length === Object.keys(previous).length && Object.entries(pieces).every(([name, value]) => previous[name] === value);
  if (Object.keys(pieces).length === 0 || (saved !== null && same)) return false;
  writeDecisions(root, pieces, saved?.raw ?? {});
  out.stdout(savedMessage(commits));
  return true;
}

/**
 * The closing line when no step ran, which must not contradict a file written in this run.
 * @param why - "leave" if the person left without changing anything, "none" if they picked no steps.
 * @param wrote - Whether the decisions file was written in this run.
 * @returns The line, with its newline.
 * @example noStepsMessage("none", true) // "No elegiste pasos; solo guardé qué piezas usa el repo.\n"
 */
export function noStepsMessage(why: "leave" | "none", wrote: boolean): string {
  return `${ui.noSteps(why, wrote)}\n`;
}

/**
 * The line that says the decisions were saved.
 * @param commits - Whether `--commit` asks about the changes at the end, so the file need not be committed by hand.
 * @returns The line.
 */
function savedMessage(commits: boolean): string {
  return `${ui.saved(DECISIONS, commits)}\n`;
}

/**
 * What the commit of `--commit` lists: the steps that worked, and the decisions file if this
 * run wrote it, in the commit's texts (not the interface's).
 * @param done - The steps that worked.
 * @param wrote - Whether the decisions file was written in this run.
 * @returns The lines.
 * @example commitLabels([], true) // ["Guardar qué piezas usa el repo en .agents/kitchen.json"]
 */
export function commitLabels(done: Pick<Step, "text">[], wrote: boolean): string[] {
  const lines = done.map((step) => commitLine(step.text));
  return wrote ? [...lines, DECISIONS_LINE] : lines;
}

/**
 * Asks which pieces the repo uses and writes the answer for every decidable piece.
 * @param root - The repo.
 * @param saved - What was read, or null if there is no file.
 * @param commits - Whether `--commit` asks about the changes at the end.
 * @param out - Where to write.
 * @returns False if the person cancelled.
 */
async function choosePieces(root: string, saved: Saved | null, commits: boolean, out: Output): Promise<boolean> {
  out.stdout(`${ui.checking}\n`);
  // No skip here: an installed, undecided piece passed in --skip still starts ticked.
  const statuses = await statusesOf(root, []);
  const ticked = DECIDABLE.filter((name) => saved?.pieces[name] === true || (saved?.pieces[name] === undefined && statuses.some((status) => status.name === name && status.installed)));
  const picked = await askPieces(DECIDABLE, ticked);
  if (picked === null) return false;
  writeDecisions(root, Object.fromEntries(DECIDABLE.map((name) => [name, picked.includes(name)])), saved?.raw ?? {});
  out.stdout(savedMessage(commits));
  return true;
}

/**
 * Leaves the repo's own skills out of a step's pick, saying so.
 * @param root - The repo.
 * @param step - A step that installs skills.
 * @param out - Where to write.
 */
function keepOwnSkills(root: string, step: Step, out: Output): void {
  if (step.skills === undefined) return;
  const own = ownInPick(root, step.skills);
  if (own.length === 0) return;
  Object.assign(step.skills, keepOwn(step.skills, own));
  out.stdout(`${ui.ownSkillsKept(own)}\n`);
}

/**
 * Asks, for a step that installs skills, which ones, and whether to replace the repo's own.
 * @param root - The repo.
 * @param step - The step.
 * @param chooseSkills - Whether to show the skills menu, or keep the step's pick.
 * @returns False if the person cancelled.
 */
async function askAboutSkills(root: string, step: Step, chooseSkills: boolean): Promise<boolean> {
  const pick = step.skills;
  if (pick === undefined) return true;
  if (chooseSkills) {
    const picked = await askSkills(pick.candidates, pick.picked.length > 0 ? pick.picked : pick.candidates.map((candidate) => candidate.id));
    if (picked === null) return false;
    pick.picked = picked;
  }
  const own = ownInPick(root, pick);
  if (own.length === 0) return true;
  const replace = await askReplace(own);
  if (replace === null) return false;
  if (replace) pick.replace = own;
  else Object.assign(pick, keepOwn(pick, own));
  return true;
}

/**
 * The steps to run: the suggested ones with `--yes`, what the person picks in a terminal,
 * or none (only shown) with `--dry-run` or without a terminal.
 * @param root - The repo.
 * @param steps - The steps offered.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The steps, "leave" if the person chose to leave, or null if nothing should run (only shown, or cancelled).
 */
async function chooseSteps(root: string, steps: Step[], options: SyncOptions, out: Output): Promise<Step[] | "leave" | null> {
  const suggested = steps.filter((step) => step.checked);
  if (options.yes) {
    if (suggested.length === 0) out.stdout(`${ui.onlyOptional(steps.map(stepLabel))}\n`);
    for (const step of suggested) keepOwnSkills(root, step, out);
    return suggested;
  }
  if (options.dryRun || !out.interactive) {
    out.stdout(`${ui.suggested(options.dryRun)}\n${steps.map((step) => `  [${step.checked ? "x" : " "}] ${stepLabel(step)}\n`).join("")}`);
    return null;
  }
  for (const step of suggested) for (const spec of step.downloads) void download(root, spec);
  const path = await askPath(suggested.length);
  if (path === "leave") return "leave";
  const chosen = path === "all" ? suggested : await askSteps(steps);
  if (chosen === null) return null;
  for (const step of chosen) {
    if (!(await askAboutSkills(root, step, path === "pick"))) return null;
  }
  return chosen;
}

/**
 * Runs one step and shows how it went: its notes, and what to do if it failed.
 * @param root - The repo.
 * @param step - The step.
 * @param progress - How progress is shown.
 * @param out - Where to write.
 * @returns Whether it worked.
 * @throws What the step throws that is not a KitError.
 */
async function runStep(root: string, step: Step, progress: Progress, out: Output): Promise<boolean> {
  const notes: string[] = [];
  const failures: string[] = [];
  const context: Context = {
    root,
    note: (text) => notes.push(text),
    fail: (text, output) => failures.push(`  ${text}\n${output === undefined ? "" : failedOutput(output)}`),
  };
  progress.start(step.text);
  let ok: boolean;
  try {
    await Promise.all(step.downloads.map((spec) => download(root, spec)));
    ok = await step.run(context);
  } catch (error) {
    if (!(error instanceof KitError)) {
      progress.stop(step.text, false);
      throw error;
    }
    failures.push(`  ${error.message}\n`);
    ok = false;
  }
  progress.stop(step.text, ok);
  for (const note of notes) out.stdout(`  · ${note}\n`);
  for (const failure of failures) out.stderr(failure);
  return ok;
}

/**
 * Runs the command; see the file's header.
 * @param options - The options.
 * @param out - Where to write and ask.
 * @returns 0, or 1 if a step failed or the person cancelled.
 * @throws KitError outside the main checkout or with a broken file; UsageError for an unknown piece.
 * @example await sync({ cwd, yes: false, dryRun: true, verbose: false, skip: [], commit: false, pieces: false }, out)
 */
export async function sync(options: SyncOptions, out: Output): Promise<number> {
  const unknown = options.skip.find((name) => !pieceNames().includes(name));
  if (unknown !== undefined) throw new UsageError(`no existe la pieza ${unknown}; son ${pieceNames().join(", ")}.`);
  if (options.yes && options.dryRun) throw new UsageError("usa --yes o --dry-run, no los dos.");
  if (options.pieces && (options.yes || options.dryRun)) throw new UsageError("usa --pieces solo, sin --yes ni --dry-run.");
  if (options.pieces && !out.interactive) throw new UsageError("--pieces pregunta qué piezas usa el repo; córrelo en una terminal.");
  const root = mainCheckout(options.cwd, "agent-kitchen apply");
  const base = options.commit ? baseBranch(root) : null;
  if (base !== null) checkReady(root, base);
  setVerbose(options.verbose);
  let saved = readDecisions(root);
  let wrote = false;
  for (const warning of saved?.warnings ?? []) warn(out, warning);
  if (options.pieces) {
    if (!(await choosePieces(root, saved, base !== null, out))) {
      out.stdout("No se cambió nada.\n");
      return 0;
    }
    saved = readDecisions(root);
    wrote = true;
  }
  const skip = [...options.skip, ...off(saved)];
  const asks = out.interactive && !options.yes && !options.dryRun;
  const saves = asks && options.skip.length === 0;
  if (out.interactive) out.stdout(`${ui.checking}\n`);
  let statuses = await statusesOf(root, skip);
  if (saved !== null && !asks && !options.dryRun) {
    const left = undecided(saved).filter((name) => statuses.some((status) => status.name === name && !status.installed));
    if (left.length > 0) {
      skip.push(...left);
      statuses = await statusesOf(root, skip);
      out.stdout(`${ui.undecided(left)}\n`);
    }
  }
  if (saved !== null) {
    const fresh = undecided(saved);
    for (const status of statuses.filter((each) => fresh.includes(each.name))) {
      status.state += ui.fresh;
      for (const step of status.steps) step.fresh = true;
    }
  }
  printStatus(statuses, off(saved).filter((name) => !options.skip.includes(name)), out);
  const steps = statuses.flatMap((status) => status.steps);
  // With --commit, a run that only wrote the decisions file still ends with the question.
  const progress = progressFor(out, options.verbose, base !== null);
  const endWithoutSteps = async (): Promise<number> => (base !== null && wrote ? commitChanges(root, base, commitLabels([], true), [], progress, options, out) : 0);
  if (steps.length === 0) {
    if (saves) wrote = saveDecisions(root, saved, statuses, [], base !== null, out) || wrote;
    out.stdout(`${ui.upToDate}\n`);
    return endWithoutSteps();
  }
  const chosen = await chooseSteps(root, steps, options, out);
  if (saves && Array.isArray(chosen)) wrote = saveDecisions(root, saved, statuses, chosen, base !== null, out) || wrote;
  if (chosen === "leave") {
    out.stdout(noStepsMessage("leave", wrote));
    return endWithoutSteps();
  }
  if (chosen === null) {
    if (wrote) {
      out.stdout(noStepsMessage("leave", wrote));
      return endWithoutSteps();
    }
    if (!options.dryRun && out.interactive) warn(out, "no se cambió nada.");
    return options.dryRun || !out.interactive ? 0 : 1;
  }
  if (chosen.length === 0) {
    if (!options.yes) out.stdout(noStepsMessage("none", wrote));
    return endWithoutSteps();
  }
  const failedSteps: Step[] = [];
  for (const step of chosen) {
    if (!(await runStep(root, step, progress, out))) failedSteps.push(step);
  }
  const failed = failedSteps.map(stepLabel);
  if (base !== null) return commitChanges(root, base, commitLabels(chosen.filter((step) => !failedSteps.includes(step)), wrote), failed, progress, options, out);
  out.stdout(`\n${ui.summary(failed)} ${ui.next(packageManager(root))}\n`);
  return failed.length === 0 ? 0 : 1;
}

/**
 * The end of `--commit`: the install if package.json changed, the changes, the question (or
 * the branch with a PR under --yes) and what git did.
 * @param root - The repo.
 * @param base - The base branch.
 * @param done - What the commit lists: the steps that worked, and the decisions file if written.
 * @param failed - The steps that failed, as the interface names them.
 * @param progress - How progress is shown, for the install.
 * @param options - The options.
 * @param out - Where to write and ask.
 * @returns 0, or 1 if a step, the install or git failed.
 */
async function commitChanges(root: string, base: string, done: string[], failed: string[], progress: Progress, options: SyncOptions, out: Output): Promise<number> {
  const summary = ui.summary(failed);
  const changed = changedPaths(root);
  if (changed.length === 0) {
    out.stdout(`\n${summary} No cambió ningún archivo: no hay nada que commitear.\n`);
    return failed.length === 0 ? 0 : 1;
  }
  const manager = packageManager(root);
  const packageChanged = changed.includes("package.json");
  if (packageChanged) {
    const text = { kind: "install-deps", manager } as const;
    progress.start(text);
    const installed = await runInstall(root, manager);
    progress.stop(text, installed.ok);
    if (!installed.ok) {
      out.stderr(failedOutput(installed.output));
      out.stdout(`\n${summary} No commiteé: el install falló y los cambios quedan sin commit.\n`);
      return 1;
    }
  }
  const paths = changedPaths(root);
  out.stdout(`\n${summary} Cambios:\n${paths.map((path) => `  ${path}`).join("\n")}\n`);
  if (failed.length > 0 && options.yes) {
    out.stdout("No commiteé porque algún paso falló; los cambios quedan sin commit.\n");
    return 1;
  }
  const branch = branchName(root, new Date());
  const choice = options.yes ? "pr" : await askFinish(base, branch, failed.length > 0);
  const result = await finish(root, choice, { base, branch, steps: done, paths, manager, packageChanged });
  for (const line of result.lines) out.stdout(`${line}\n`);
  return result.ok && failed.length === 0 ? 0 : 1;
}
