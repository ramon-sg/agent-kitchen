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
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkRunner, chooseRunner, RUNNER_FILE, type Runner, toolCommandText, writeRunnerConfig } from "@ramon-sg/runner";
import { KitError } from "../output.js";
import { type Check, type Context, FLOW_PACKAGE, type PieceStatus, SKILLS_MANAGER, SKILLS_MANIFEST, type Step } from "../piece.js";
import { dependencyEntries, dependencyVersion, ECOSYSTEM_TOOLS, editPackage, isObject, lockfiles, ownDependencies, packageManager, readJson, writeJson } from "../repo.js";
import { CLOUD_CONFIG, CLOUD_PACKAGE, GITHUB_REST, GUARD_MANIFEST, GUARD_PACKAGE, RUNNER_MINIMUMS, runnerLatest, toolVersion } from "../runner-mode.js";
import { ui } from "../texts/index.js";
import { compareSemver, isExactVersion, npmLatest, raiseTool, repoMode, setRunner } from "../tools.js";
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
 * @param forced - The runner `--runner` names, if it did: the move uses it, and a repo in runner mode changes to it.
 * @returns The piece's status, or null for a legacy repo with none of the tools.
 * @example (await runnerStatus(root, []))?.state // "bun, en .agents/runner.json"
 */
export async function runnerStatus(root: string, skip: string[], forced?: Runner): Promise<PieceStatus | null> {
  const said = ui.pieces.runner;
  const base = { name: NAME, summary: said.summary };
  const mode = repoMode(root);
  if (mode.kind === "runner") {
    // Only what this run can take out: a tool's leftovers wait while runner.json does not pin it
    // and its piece is left out, since nothing in this run will pin it.
    const pieceFor = (pkg: string): string => (pkg === GITHUB_REST ? FLOW : pieceOf(pkg));
    const left = labels(leftovers(root, (pkg) => mode.tools[pkg] !== undefined || !skip.includes(pieceFor(pkg)), false));
    const change = forced === undefined ? null : changeStep(mode.runner, forced, mode.tools, skip);
    if (left.length === 0 && change?.step === undefined) return { ...base, installed: true, state: `${said.inRunner(mode.runner)}${change?.blocked ?? ""}`, steps: [] };
    const first = change?.step === undefined ? [] : [change.step];
    if (left.length === 0) return { ...base, installed: true, state: said.inRunner(mode.runner), steps: first };
    const finish: Step = {
      piece: NAME,
      checked: true,
      downloads: [],
      text: { kind: "runner-finish", left },
      run: (context) => {
        // The end line says what was taken out, which a step that failed earlier in the run may have cut short.
        finish.text = { kind: "runner-finish", left: finishMove(context, false) };
        return Promise.resolve(true);
      },
    };
    return { ...base, installed: true, state: `${said.inRunner(mode.runner)}${change?.blocked ?? ""}${said.leftovers}`, steps: [...first, finish] };
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
  const chosen = forced === undefined ? ((await chooseRunner({})) ?? { runner: "node" as const, warning: null }) : { runner: forced, warning: null };
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
 * The step that changes the runner of a repo in runner mode (or, with the runner it has, rewrites
 * with it what a change cut short left), or what keeps this run from it.
 * Like the move, it takes every tool runner.json pins, so a tool whose piece this run leaves out
 * holds it back.
 * @param from - The repo's runner.
 * @param to - The runner `--runner` names.
 * @param tools - What runner.json pins.
 * @param skip - The pieces this run leaves out.
 * @returns The step, or the text for the state when a piece held it back.
 */
function changeStep(from: Runner, to: Runner, tools: Record<string, string>, skip: string[]): { step?: Step; blocked?: string } {
  const pinned = ORDER.filter(([pkg]) => tools[pkg] !== undefined);
  const leftOut = pinned.map(([, piece]) => piece).filter((piece) => skip.includes(piece));
  if (leftOut.length > 0) return { blocked: `; ${ui.pieces.runner.changeLeftOut(leftOut)}` };
  const names = pinned.map(([pkg, piece]) => `${piece} ${tools[pkg] as string}`);
  return {
    step: {
      piece: NAME,
      checked: true,
      // Bun cannot fill its cache ahead; npx's cache only helps the Node runner, and the repo still runs with the old one.
      downloads: [],
      text: from === to ? { kind: "runner-rewrite", runner: to, tools: names.length === 0 ? [RUNNER_FILE] : names } : { kind: "runner-change", from, to, tools: names.length === 0 ? [RUNNER_FILE] : names },
      run: (context) => changeRunner(context, to),
    },
  };
}

/**
 * Changes the runner of a repo in runner mode: writes it in runner.json, runs the `apply` of each
 * tool runner.json pins at its version (which rewrites its hooks and shortcuts with the new
 * runner), and sets packageManager. A tool that fails does not stop the others; nothing is undone.
 * @param context - Where it runs, in runner mode.
 * @param to - The runner.
 * @returns Whether every tool worked.
 */
async function changeRunner(context: Context, to: Runner): Promise<boolean> {
  const said = ui.pieces.runner;
  if (setRunner(context.root, to)) context.note(said.written(RUNNER_FILE, to));
  const mode = repoMode(context.root);
  const tools = mode.kind === "runner" ? mode.tools : {};
  const runs: Record<string, (version: string) => Promise<boolean>> = {
    [FLOW_PACKAGE]: (version) => applyFlow(context, version),
    [GUARD_PACKAGE]: (version) => installGuard(context, version),
    [CLOUD_PACKAGE]: (version) => initCloud(context, version),
    [SKILLS_MANAGER]: (version) => updateInRunner(context, version),
  };
  let worked = true;
  for (const [pkg] of ORDER) {
    const version = tools[pkg];
    const run = runs[pkg];
    if (version === undefined || run === undefined) continue;
    if (!(await attempt(context, () => run(version)))) worked = false;
  }
  setPackageManager(context, to);
  return worked;
}

/**
 * The version `bun --version` prints.
 * @returns The version, or null if bun is not there or prints something else.
 */
function bunVersion(): string | null {
  const result = spawnSync("bun", ["--version"], { encoding: "utf8" });
  const version = result.status === 0 ? result.stdout.trim() : "";
  return /^\d+\.\d+\.\d+/.test(version) ? version : null;
}

/**
 * Follows a change of runner in the `packageManager` of package.json: `bun@<its version>` for
 * Bun, none for Node. Only in a repo with no dependencies of its own, where package.json holds
 * just the shortcuts; with some, `packageManager` is the repo's.
 * @param context - Where it runs.
 * @param to - The new runner.
 */
function setPackageManager(context: Context, to: Runner): void {
  const said = ui.pieces.runner;
  if (ownDependencies(context.root).length > 0 || readJson(context.root, "package.json") === null) return;
  if (to === "node") {
    if (editPackage(context.root, (pkg) => delete pkg.packageManager)) context.note(said.packageManagerRemoved);
    return;
  }
  const version = bunVersion();
  if (version === null) {
    context.note(said.bunVersionUnknown);
    return;
  }
  if (editPackage(context.root, (pkg) => (pkg.packageManager = `bun@${version}`))) context.note(said.packageManagerSet(`bun@${version}`));
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
    [said.cleanup, () => {
      finishMove(context, true);
      setPackageManager(context, runner);
      return Promise.resolve(true);
    }],
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
  /** Ecosystem tools in devDependencies, and also in dependencies at the end of the move (outside it, one there is the repo's own use). */
  deps: string[];
  /** Scripts that are only a skills-manager command, run from node_modules or through npx. */
  scripts: string[];
  /** Scripts that run skills-manager unpinned among other commands: left, with a note. */
  mixed: string[];
  /** Whether `.claude/cloud.json` still has `version`. */
  cloudVersion: boolean;
  /** Lockfiles and node_modules: when the repo has no dependencies of its own, and only along with a legacy trace. */
  files: string[];
  /** The `session-notice` command to pin, if its hook is not at runner.json's skills-manager. */
  hook: string | null;
}

/**
 * What the legacy repo left behind, in a repo in runner mode. The lockfile and node_modules
 * count only when package.json keeps no dependency entry in any field (nor workspaces) once the
 * cleanup is done, and a legacy trace goes with them (an
 * ecosystem tool in devDependencies, or the `version` of cloud.json), or at the end of the move:
 * a repo in runner mode that keeps them on its own may well use them.
 * @param root - The repo, in runner mode.
 * @param can - Whether a tool's leftovers may go: runner.json pins it (or will, in this run).
 * @param moving - Whether it is the end of the move, which always took legacy traces out.
 * @returns The leftovers.
 */
function leftovers(root: string, can: (pkg: string) => boolean, moving: boolean): Leftovers {
  const mode = repoMode(root);
  const tools = mode.kind === "runner" ? mode.tools : {};
  const pkg = readJson(root, "package.json");
  const fields = (moving ? ["dependencies", "devDependencies"] : ["devDependencies"]).map((field) => (isObject(pkg?.[field]) ? pkg[field] : {}));
  const deps = ECOSYSTEM_TOOLS.filter((name) => fields.some((field) => name in field) && can(name));
  const scripts = isObject(pkg?.scripts) ? Object.entries(pkg.scripts).filter(([, command]) => typeof command === "string" && SKILLS_RUN.test(command)) : [];
  const ownsScripts = can(SKILLS_MANAGER);
  const cloudVersion = can(CLOUD_PACKAGE) && readJson(root, CLOUD_CONFIG)?.version !== undefined;
  const traced = moving || deps.length > 0 || cloudVersion;
  // The lockfile and node_modules go only if package.json keeps no dependency at all once the cleanup is done.
  const kept = dependencyEntries(root, pkg, { names: deps, fields: moving ? ["dependencies", "devDependencies"] : ["devDependencies"] });
  const files = !traced || kept.length > 0 ? [] : [...lockfiles(root), ...(existsSync(join(root, "node_modules")) ? ["node_modules"] : [])];
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
 * `session-notice` hook to runner.json's skills-manager, and, when package.json keeps no
 * dependency entry, deletes node_modules and the lockfile. With some left, the install runs at
 * the end of the run if package.json changed. A tool runner.json does not pin yet stays where it is: its
 * own piece offers it again.
 * @param context - Where it runs, in runner mode.
 * At the end of the move the tools it pinned go from dependencies and devDependencies; outside
 * it, only from devDependencies: one in dependencies is then the repo's own use.
 * @param moving - Whether it is the end of the move, which always changed package.json.
 * @returns What it took out, as the step names it.
 */
function finishMove(context: Context, moving: boolean): string[] {
  const said = ui.pieces.runner;
  const { root } = context;
  const pins = repoMode(root);
  const left = leftovers(root, (pkg) => pins.kind === "runner" && pins.tools[pkg] !== undefined, moving);
  const changed = editPackage(root, (pkg) => {
    for (const field of moving ? ["dependencies", "devDependencies"] : ["devDependencies"]) {
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
  if (dependencyEntries(root, readJson(root, "package.json")).length > 0 && (moving || changed)) context.note(said.installLater(packageManager(root)));
  return labels(left);
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
