/**
 * @file The move of a legacy repo to `.agents/runner.json`. A legacy repo keeps its tools'
 * versions where they always were (issue-flow, github-rest and skills-manager in
 * devDependencies, agent-cloud-kit in `.claude/cloud.json`, claude-repo-guard in its manifest)
 * and runs them with npx. The move is all the tools or none: it is offered only when npm's
 * latest of every installed tool already reads runner.json (`RUNNER_MINIMUMS`); otherwise the
 * table says which minimum npm lacks. While it is offered, the tools offer no legacy step of
 * their own (sync.ts drops them), since the move takes each to its latest.
 *
 * The step, in this order, stopping at the first part that fails (nothing is undone):
 * 1. Writes runner.json with the runner (`chooseRunner`: Bun if it is installed, else Node) and
 *    each installed tool at its latest, before any tool runs: the guard stays in legacy mode
 *    in a repo with its manifest and no runner.json.
 * 2. issue-flow's `apply` at its latest (which drops it and github-rest from package.json and
 *    rewrites its hooks and shortcuts), and github-rest rises as after any `apply`.
 * 3. claude-repo-guard's `apply` from npm. Its manifest stays: its uninstall reads it.
 * 4. agent-cloud-kit's `init`, and then the `version` of `.claude/cloud.json` goes (the file stays).
 * 5. skills-manager at its latest (its install, its entry, its `session-notice` hook); then
 *    agent-kitchen drops it (and github-rest, if still there) from package.json, with the
 *    scripts that ran it from node_modules, and moves the flow's skills to the flow's new tag.
 * 6. With dependencies of its own left, the repo's install runs at the end of the run, as after
 *    any step that changes package.json; without any, node_modules and the lockfile go.
 *    package.json stays: it has the shortcuts.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkRunner, chooseRunner, RUNNER_FILE, type Runner, writeRunnerConfig } from "@ramon-sg/runner";
import { KitError } from "../output.js";
import { type Check, type Context, FLOW_PACKAGE, type PieceStatus, SKILLS_MANAGER, SKILLS_MANIFEST, type Step } from "../piece.js";
import { dependencyVersion, editPackage, isObject, lockfiles, ownDependencies, packageManager, readJson, writeJson } from "../repo.js";
import { CLOUD_CONFIG, CLOUD_PACKAGE, GITHUB_REST, GUARD_MANIFEST, GUARD_PACKAGE, RUNNER_MINIMUMS, runnerLatest, toolVersion } from "../runner-mode.js";
import { ui } from "../texts/index.js";
import { compareSemver, isExactVersion, npmLatest, repoMode } from "../tools.js";
import { init as initCloud, moveConfig, NAME as CLOUD } from "./cloud.js";
import { install as installGuard, NAME as GUARD } from "./guard.js";
import { applyFlow, moveSkills, NAME as FLOW } from "./issue-flow.js";
import { NAME as SKILLS_MANAGER_PIECE, updateInRunner } from "./skills-manager.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "runner";

/** The tools the move takes, in the order it runs them, with the piece of each. */
const ORDER: [pkg: string, piece: string][] = [
  [FLOW_PACKAGE, FLOW],
  [GUARD_PACKAGE, GUARD],
  [CLOUD_PACKAGE, CLOUD],
  [SKILLS_MANAGER, SKILLS_MANAGER_PIECE],
];

/** The pieces whose steps the move takes over while it is offered. */
export const MOVED_PIECES = ORDER.map(([, piece]) => piece);

/** A script that runs skills-manager unpinned, from node_modules or through npx. */
const SKILLS_SCRIPT = /^(?:npx\s+(?:(?:--yes|-y)\s+)?)?(?:@ramon-sg\/)?skills-manager(?:\s|$)/;

/**
 * The tools a legacy repo has, where a legacy repo keeps them.
 * @param root - The repo.
 * @returns Their packages, in the move's order.
 */
function installedTools(root: string): string[] {
  const pkg = readJson(root, "package.json");
  const has: Record<string, boolean> = {
    [FLOW_PACKAGE]: dependencyVersion(pkg, FLOW_PACKAGE) !== null,
    [GUARD_PACKAGE]: readJson(root, GUARD_MANIFEST) !== null,
    [CLOUD_PACKAGE]: readJson(root, CLOUD_CONFIG) !== null,
    [SKILLS_MANAGER]: dependencyVersion(pkg, SKILLS_MANAGER) !== null || readJson(root, SKILLS_MANIFEST) !== null,
  };
  return ORDER.map(([pkgName]) => pkgName).filter((pkgName) => has[pkgName] === true);
}

/**
 * The version a tool moves to: npm's latest, or the repo's own if it is newer.
 * @param root - The repo, in legacy mode.
 * @param pkg - The tool's package.
 * @returns The version, or null if npm cannot tell.
 */
async function targetOf(root: string, pkg: string): Promise<string | null> {
  const latest = await runnerLatest(pkg);
  if (latest === null) return null;
  const own = toolVersion(root, pkg);
  return own !== null && compareSemver(own, latest) > 0 ? own : latest;
}

/**
 * The piece of a package, as the step names it.
 * @param pkg - The package.
 * @returns The piece's name.
 */
const pieceOf = (pkg: string): string => ORDER.find(([each]) => each === pkg)?.[1] ?? pkg;

/**
 * What the repo has of runner.json, and, in a legacy repo whose tools can all move, the step
 * that moves them.
 * A tool whose piece this run leaves out (`--skip`, or false in `.agents/kitchen.json`) is not
 * run behind the person's back: the move waits until it can take every tool.
 * @param root - The repo.
 * @param skip - The pieces this run leaves out.
 * @returns The piece's status, or null for a legacy repo with none of the tools.
 * @example (await runnerStatus(root, []))?.state // "bun, en .agents/runner.json"
 */
export async function runnerStatus(root: string, skip: string[]): Promise<PieceStatus | null> {
  const said = ui.pieces.runner;
  const base = { name: NAME, summary: said.summary };
  const mode = repoMode(root);
  if (mode.kind === "runner") return { ...base, installed: true, state: said.inRunner(mode.runner), steps: [] };
  const tools = installedTools(root);
  if (tools.length === 0) return null;
  const legacy = { ...base, installed: false, steps: [] };
  const flow = dependencyVersion(readJson(root, "package.json"), FLOW_PACKAGE);
  if (flow !== null && !isExactVersion(flow)) return { ...legacy, state: said.notExact(flow) };
  const leftOut = tools.map(pieceOf).filter((piece) => skip.includes(piece));
  if (leftOut.length > 0) return { ...legacy, state: said.leftOut(leftOut) };
  const rest = dependencyVersion(readJson(root, "package.json"), GITHUB_REST) !== null;
  const [found, restTarget] = await Promise.all([Promise.all(tools.map((pkg) => targetOf(root, pkg))), rest ? npmLatest(GITHUB_REST) : Promise.resolve(null)]);
  if (found.some((version) => version === null)) return { ...legacy, state: `${said.legacy}${ui.pieces.common.npmDown}` };
  const targets = new Map(tools.map((pkg, index) => [pkg, found[index] as string]));
  const missing = tools.filter((pkg) => compareSemver(targets.get(pkg) as string, RUNNER_MINIMUMS[pkg] as string) < 0);
  if (missing.length > 0) return { ...legacy, state: said.waiting(missing.map((pkg) => `${pkg} ${RUNNER_MINIMUMS[pkg] as string}`)) };
  const chosen = (await chooseRunner({})) ?? { runner: "node" as const, warning: null };
  const step: Step = {
    piece: NAME,
    checked: true,
    // Bun cannot fill its cache ahead; npx's cache only helps the Node runner.
    downloads: chosen.runner === "node" ? tools.map((pkg) => `${pkg}@${targets.get(pkg) as string}`) : [],
    text: { kind: "runner-migrate", runner: chosen.runner, tools: tools.map((pkg) => `${pieceOf(pkg)} ${targets.get(pkg) as string}`) },
    run: (context) => migrate(context, chosen.runner, chosen.warning, targets, restTarget),
  };
  return { ...legacy, state: said.ready, steps: [step] };
}

/**
 * Runs one part of the move, turning an error of agent-kitchen into a failure of that part.
 * @param context - Where it runs.
 * @param part - The part.
 * @returns Whether it worked.
 * @throws What the part throws that is not a KitError.
 */
async function attempt(context: Context, part: () => Promise<boolean>): Promise<boolean> {
  try {
    return await part();
  } catch (error) {
    if (!(error instanceof KitError)) throw error;
    context.fail(error.message);
    return false;
  }
}

/**
 * The move; see the file's header.
 * @param context - Where it runs.
 * @param runner - The runner to write.
 * @param warning - What to say about it, if anything (Node because Bun is missing).
 * @param targets - Each installed tool's version.
 * @param rest - github-rest's latest, if package.json has it, or null.
 * @returns Whether every part worked.
 */
async function migrate(context: Context, runner: Runner, warning: string | null, targets: Map<string, string>, rest: string | null): Promise<boolean> {
  const said = ui.pieces.runner;
  if (warning !== null) context.note(warning);
  const tools = Object.fromEntries([...targets, ...(rest === null ? [] : [[GITHUB_REST, rest] as const])]);
  writeRunnerConfig(context.root, { runner, tools, extra: {} });
  context.note(said.written(RUNNER_FILE, runner));
  const flow = targets.get(FLOW_PACKAGE);
  const guard = targets.get(GUARD_PACKAGE);
  const cloud = targets.get(CLOUD_PACKAGE);
  const skillsManager = targets.get(SKILLS_MANAGER);
  const parts: [string, () => Promise<boolean>][] = [
    ...(flow === undefined ? [] : [[FLOW, () => applyFlow(context, flow)] as [string, () => Promise<boolean>]]),
    ...(guard === undefined ? [] : [[GUARD, () => installGuard(context, guard)] as [string, () => Promise<boolean>]]),
    ...(cloud === undefined ? [] : [[CLOUD, () => moveCloud(context, cloud)] as [string, () => Promise<boolean>]]),
    ...(skillsManager === undefined ? [] : [[SKILLS_MANAGER_PIECE, () => moveSkillsManager(context, skillsManager, flow ?? null)] as [string, () => Promise<boolean>]]),
    [said.cleanup, () => Promise.resolve(cleanUp(context))],
  ];
  for (const [index, [, part]] of parts.entries()) {
    if (await attempt(context, part)) continue;
    const left = parts.slice(index + 1).map(([name]) => name);
    if (left.length > 0) context.note(said.notRun(left));
    return false;
  }
  return true;
}

/**
 * agent-cloud-kit's `init` at its new version, and then its `version` out of `.claude/cloud.json`,
 * which `init` never removes and runner.json replaces. A `$schema` pinned to a version follows it.
 * @param context - Where it runs, in runner mode.
 * @param version - The version.
 * @returns Whether `init` worked.
 */
async function moveCloud(context: Context, version: string): Promise<boolean> {
  moveConfig(context.root, version, false);
  if (!(await initCloud(context, version))) return false;
  const config = readJson(context.root, CLOUD_CONFIG);
  if (config === null || !("version" in config)) return true;
  const { version: _gone, ...rest } = config;
  writeJson(context.root, CLOUD_CONFIG, rest);
  context.note(ui.pieces.runner.versionRemoved(CLOUD_CONFIG));
  return true;
}

/**
 * skills-manager at its new version; then out of package.json, with github-rest if still there
 * and the scripts that ran it unpinned; then the flow's skills to the flow's new tag.
 * @param context - Where it runs, in runner mode.
 * @param version - skills-manager's version.
 * @param flow - The flow's new version, or null if the repo has no flow.
 * @returns Whether it worked.
 */
async function moveSkillsManager(context: Context, version: string, flow: string | null): Promise<boolean> {
  if (!(await updateInRunner(context, version))) return false;
  const removed: string[] = [];
  editPackage(context.root, (pkg) => {
    for (const field of ["dependencies", "devDependencies"]) {
      const deps = pkg[field];
      if (!isObject(deps)) continue;
      for (const name of [SKILLS_MANAGER, GITHUB_REST]) {
        if (!(name in deps)) continue;
        delete deps[name];
        removed.push(name);
      }
      if (Object.keys(deps).length === 0) delete pkg[field];
    }
    const scripts = pkg.scripts;
    if (!isObject(scripts)) return;
    for (const [name, command] of Object.entries(scripts)) {
      if (typeof command !== "string" || !SKILLS_SCRIPT.test(command.trim())) continue;
      delete scripts[name];
      removed.push(`scripts.${name}`);
    }
    if (Object.keys(scripts).length === 0) delete pkg.scripts;
  });
  if (removed.length > 0) context.note(ui.pieces.runner.cleaned(removed));
  return flow === null || moveSkills(context, flow);
}

/**
 * Leaves the repo's install for the end of the run if it has dependencies of its own; else
 * deletes node_modules and the lockfile, which only held the tools.
 * @param context - Where it runs.
 * @returns True.
 */
function cleanUp(context: Context): boolean {
  if (ownDependencies(context.root).length > 0) {
    context.note(ui.pieces.runner.installLater(packageManager(context.root)));
    return true;
  }
  const gone = [...lockfiles(context.root), ...(existsSync(join(context.root, "node_modules")) ? ["node_modules"] : [])];
  for (const path of gone) rmSync(join(context.root, path), { recursive: true, force: true });
  if (gone.length > 0) context.note(ui.pieces.runner.removed(gone));
  return true;
}

/**
 * In runner mode, whether runner.json is valid and its runner installed. A legacy repo gets
 * none: its doctor stays as it was, and `apply` is where the move is offered.
 * @param root - The repo.
 * @returns The checks.
 * @example runnerChecks(root)[0]?.status // "ok"
 */
export function runnerChecks(root: string): Check[] {
  if (repoMode(root).kind !== "runner") return [];
  // The library's "warn" is a note here.
  return checkRunner(root).map(({ name, status, detail }) => ({ name, status: status === "warn" ? "info" : status, detail }));
}
