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
 *    github-rest (never lowered), before any tool runs: the guard stays in legacy mode in a repo
 *    with its manifest and no runner.json. Each tool gets its entry only when its part works.
 * 2. issue-flow's `apply` at its latest (which drops it and github-rest from package.json and
 *    rewrites its hooks and shortcuts), and github-rest rises as after any `apply`.
 * 3. claude-repo-guard's `apply` from npm. Its manifest stays: its uninstall reads it.
 * 4. agent-cloud-kit's `init`.
 * 5. skills-manager at its latest (its install, its entry, its `session-notice` hook), and the
 *    flow's skills to the flow's new tag.
 * 6. The cleanup (`finishMove`): the pinned tools out of package.json, with the scripts that
 *    were only a skills-manager command; `version` out of `.claude/cloud.json` (the file stays);
 *    without dependencies of the repo's own, node_modules and the lockfile go; with some, the
 *    repo's install runs at the end of the run. package.json stays: it has the shortcuts.
 *
 * A move cut short leaves a repo in runner mode where the tools that failed have no entry: their
 * own pieces offer them again at their latest, and this piece offers a step that finishes the
 * cleanup, which runs after theirs.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkRunner, chooseRunner, RUNNER_FILE, type Runner, toolCommandText, writeRunnerConfig } from "@ramon-sg/runner";
import { KitError } from "../output.js";
import { type Check, type Context, FLOW_PACKAGE, type PieceStatus, SKILLS_MANAGER, SKILLS_MANIFEST, type Step } from "../piece.js";
import { dependencyVersion, ECOSYSTEM_TOOLS, editPackage, isObject, lockfiles, ownDependencies, packageManager, readJson, writeJson } from "../repo.js";
import { CLOUD_CONFIG, CLOUD_PACKAGE, GITHUB_REST, GUARD_MANIFEST, GUARD_PACKAGE, RUNNER_MINIMUMS, runnerLatest, toolVersion } from "../runner-mode.js";
import { ui } from "../texts/index.js";
import { compareSemver, isExactVersion, npmLatest, raiseTool, repoMode } from "../tools.js";
import { init as initCloud, moveConfig, NAME as CLOUD } from "./cloud.js";
import { install as installGuard, NAME as GUARD } from "./guard.js";
import { applyFlow, moveSkills, NAME as FLOW } from "./issue-flow.js";
import { NAME as SKILLS_MANAGER_PIECE, pinSessionNotice, sessionNoticeCommands, updateInRunner } from "./skills-manager.js";

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

/** A script that is only a skills-manager command, unpinned, from node_modules or through npx. */
const SKILLS_SCRIPT = /^(?:npx\s+(?:(?:--yes|-y)\s+)?)?(?:@ramon-sg\/)?skills-manager(?:\s+[^&|;<>()`$]*)?$/;

/** A script that runs skills-manager unpinned anywhere in it. */
const SKILLS_RUN = /(?:^|[\s&|;(])(?:npx\s+(?:(?:--yes|-y)\s+)?)?(?:@ramon-sg\/)?skills-manager(?:\s|$|[;&|)])/;

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
 * The github-rest runner.json starts with, when the repo has it or the flow: the newer of the
 * exact one package.json has and npm's latest, so the move never lowers it.
 * @param root - The repo, in legacy mode.
 * @param tools - The installed tools.
 * @returns The version, or null if there is none to seed (issue-flow's apply seeds its own).
 */
async function restSeed(root: string, tools: string[]): Promise<string | null> {
  const own = dependencyVersion(readJson(root, "package.json"), GITHUB_REST);
  if (own === null && !tools.includes(FLOW_PACKAGE)) return null;
  const known = [own !== null && isExactVersion(own) ? own : null, await npmLatest(GITHUB_REST)].filter((each): each is string => each !== null);
  return known.sort(compareSemver).at(-1) ?? null;
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
  if (mode.kind === "runner") {
    const left = labels(leftovers(root, false));
    if (left.length === 0) return { ...base, installed: true, state: said.inRunner(mode.runner), steps: [] };
    const finish: Step = { piece: NAME, checked: true, downloads: [], text: { kind: "runner-finish", left }, run: (context) => Promise.resolve(finishMove(context, false)) };
    return { ...base, installed: true, state: `${said.inRunner(mode.runner)}${said.leftovers}`, steps: [finish] };
  }
  const tools = installedTools(root);
  if (tools.length === 0) return null;
  const legacy = { ...base, installed: false, steps: [] };
  const flow = dependencyVersion(readJson(root, "package.json"), FLOW_PACKAGE);
  if (flow !== null && !isExactVersion(flow)) return { ...legacy, state: said.notExact(flow) };
  const leftOut = tools.map(pieceOf).filter((piece) => skip.includes(piece));
  if (leftOut.length > 0) return { ...legacy, state: said.leftOut(leftOut) };
  const [found, restTarget] = await Promise.all([Promise.all(tools.map((pkg) => targetOf(root, pkg))), restSeed(root, tools)]);
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
 * @param rest - The github-rest to seed, or null.
 * @returns Whether every part worked.
 */
async function migrate(context: Context, runner: Runner, warning: string | null, targets: Map<string, string>, rest: string | null): Promise<boolean> {
  const said = ui.pieces.runner;
  if (warning !== null) context.note(warning);
  // Only the runner and github-rest: each tool gets its entry when its part works, so one that
  // fails has none, and the next run offers it again in runner mode.
  writeRunnerConfig(context.root, { runner, tools: rest === null ? {} : { [GITHUB_REST]: rest }, extra: {} });
  context.note(said.written(RUNNER_FILE, runner));
  const flow = targets.get(FLOW_PACKAGE);
  const guard = targets.get(GUARD_PACKAGE);
  const cloud = targets.get(CLOUD_PACKAGE);
  const skillsManager = targets.get(SKILLS_MANAGER);
  type Part = [string, () => Promise<boolean>];
  const parts: Part[] = [
    ...(flow === undefined ? [] : [[FLOW, () => pinned(context, FLOW_PACKAGE, flow, applyFlow(context, flow))] as Part]),
    ...(guard === undefined ? [] : [[GUARD, () => pinned(context, GUARD_PACKAGE, guard, installGuard(context, guard))] as Part]),
    ...(cloud === undefined ? [] : [[CLOUD, () => moveCloud(context, cloud)] as Part]),
    ...(skillsManager === undefined ? [] : [[SKILLS_MANAGER_PIECE, async () => (await updateInRunner(context, skillsManager)) && (flow === undefined || moveSkills(context, flow))] as Part]),
    [said.cleanup, () => Promise.resolve(finishMove(context, true))],
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
 * Pins a tool in runner.json once its part worked, in case the tool did not write its entry.
 * @param context - Where it runs, in runner mode.
 * @param pkg - The tool.
 * @param version - Its version.
 * @param part - The part that runs it.
 * @returns Whether the part worked.
 */
async function pinned(context: Context, pkg: string, version: string, part: Promise<boolean>): Promise<boolean> {
  if (!(await part)) return false;
  raiseTool(context.root, pkg, version);
  return true;
}

/**
 * agent-cloud-kit's `init` at its new version (a `$schema` pinned to a version follows it), and
 * its entry in runner.json. Its `version` in `.claude/cloud.json` goes in the cleanup.
 * @param context - Where it runs, in runner mode.
 * @param version - The version.
 * @returns Whether `init` worked.
 */
function moveCloud(context: Context, version: string): Promise<boolean> {
  moveConfig(context.root, version, false);
  return pinned(context, CLOUD_PACKAGE, version, initCloud(context, version));
}

/** What a legacy repo leaves once its tools are in runner.json. */
interface Leftovers {
  /** Ecosystem tools in dependencies or devDependencies. */
  deps: string[];
  /** Scripts that are only a skills-manager command, run from node_modules or through npx. */
  scripts: string[];
  /** Scripts that run skills-manager unpinned among other commands: left, with a note. */
  mixed: string[];
  /** Whether `.claude/cloud.json` still has `version`. */
  cloudVersion: boolean;
  /** Lockfiles and node_modules, when the repo has no dependencies of its own. */
  files: string[];
  /** The `session-notice` command to pin, if its hook is not at runner.json's skills-manager. */
  hook: string | null;
}

/**
 * What the legacy repo left behind, in a repo in runner mode.
 * @param root - The repo, in runner mode.
 * @param pinnedOnly - Only the tools runner.json pins: the ones the cleanup may take out.
 * @returns The leftovers.
 */
function leftovers(root: string, pinnedOnly: boolean): Leftovers {
  const mode = repoMode(root);
  const tools = mode.kind === "runner" ? mode.tools : {};
  const pkg = readJson(root, "package.json");
  const deps = ECOSYSTEM_TOOLS.filter((name) => dependencyVersion(pkg, name) !== null && (!pinnedOnly || tools[name] !== undefined));
  const scripts = isObject(pkg?.scripts) ? Object.entries(pkg.scripts).filter(([, command]) => typeof command === "string" && SKILLS_RUN.test(command)) : [];
  const ownsScripts = !pinnedOnly || tools[SKILLS_MANAGER] !== undefined;
  const cloudVersion = (!pinnedOnly || tools[CLOUD_PACKAGE] !== undefined) && readJson(root, CLOUD_CONFIG)?.version !== undefined;
  const files = ownDependencies(root).length > 0 ? [] : [...lockfiles(root), ...(existsSync(join(root, "node_modules")) ? ["node_modules"] : [])];
  const version = tools[SKILLS_MANAGER];
  const command = version === undefined || mode.kind !== "runner" ? null : toolCommandText(mode.runner, SKILLS_MANAGER, version, ["session-notice"]);
  const hooks = sessionNoticeCommands(root);
  const hook = command !== null && hooks.length > 0 && hooks.some((each) => each !== command) ? command : null;
  return {
    deps,
    scripts: ownsScripts ? scripts.filter(([, command]) => SKILLS_SCRIPT.test(String(command).trim())).map(([name]) => name) : [],
    mixed: ownsScripts ? scripts.filter(([, command]) => !SKILLS_SCRIPT.test(String(command).trim())).map(([name]) => name) : [],
    cloudVersion,
    files,
    hook,
  };
}

/**
 * The leftovers as the step names them; none if there is nothing to clean.
 * @param left - The leftovers.
 * @returns Short labels.
 */
function labels(left: Leftovers): string[] {
  const said = ui.pieces.runner;
  const inPackage = [...left.deps, ...left.scripts.map((name) => `scripts.${name}`)];
  return [...(inPackage.length > 0 ? [said.leftPackage(inPackage)] : []), ...(left.cloudVersion ? [said.leftVersion(CLOUD_CONFIG)] : []), ...left.files, ...(left.hook === null ? [] : [said.leftHook])];
}

/**
 * The last part of the move, and the step that finishes one a failure cut short: takes out of
 * package.json the tools runner.json pins and the scripts that ran skills-manager alone, the
 * `version` of `.claude/cloud.json` once runner.json pins agent-cloud-kit, re-pins the
 * `session-notice` hook to runner.json's skills-manager, and, without dependencies of the
 * repo's own, deletes node_modules and the lockfile. With some, the install runs at the end of
 * the run if package.json changed. A tool runner.json does not pin yet stays where it is: its
 * own piece offers it again.
 * @param context - Where it runs, in runner mode.
 * @param moving - Whether it is the end of the move, which always changed package.json.
 * @returns True.
 */
function finishMove(context: Context, moving: boolean): boolean {
  const said = ui.pieces.runner;
  const { root } = context;
  const left = leftovers(root, true);
  const changed = editPackage(root, (pkg) => {
    for (const field of ["dependencies", "devDependencies"]) {
      const deps = pkg[field];
      if (!isObject(deps)) continue;
      for (const name of left.deps) delete deps[name];
      if (Object.keys(deps).length === 0) delete pkg[field];
    }
    const scripts = pkg.scripts;
    if (!isObject(scripts)) return;
    for (const name of left.scripts) delete scripts[name];
    if (Object.keys(scripts).length === 0) delete pkg.scripts;
  });
  const removed = [...left.deps, ...left.scripts.map((name) => `scripts.${name}`)];
  if (removed.length > 0) context.note(said.cleaned(removed));
  for (const name of left.mixed) context.note(said.scriptKept(name));
  if (left.cloudVersion) {
    const { version: _gone, ...config } = readJson(root, CLOUD_CONFIG) ?? {};
    writeJson(root, CLOUD_CONFIG, config);
    context.note(said.versionRemoved(CLOUD_CONFIG));
  }
  if (left.hook !== null && pinSessionNotice(root, left.hook)) context.note(ui.pieces.skillsManager.hookPinned(left.hook));
  for (const path of left.files) rmSync(join(root, path), { recursive: true, force: true });
  if (left.files.length > 0) context.note(said.removed(left.files));
  if (ownDependencies(root).length > 0 && (moving || changed)) context.note(said.installLater(packageManager(root)));
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
