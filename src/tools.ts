/**
 * @file How agent-kitchen reaches the other tools and their releases: the repo's runner to run
 * them (always by their scoped name or GitHub spec, because the unscoped names on npm belong to
 * other people), an HTTP read of the npm registry for the latest version and a version's dependencies, and `git ls-remote` for the latest
 * `vX.Y.Z` tag on GitHub. Everything is asynchronous so the lookups run at the same time,
 * and each lookup runs once per process. A lookup that fails, or takes over 20 seconds,
 * gives null: the piece is shown, not offered. git never asks for credentials here.
 *
 * The runner is the one `.agents/runner.json` names: `bun x --bun <pkg>@<version>` with Bun (the
 * default) and `npx --yes <pkg>@<version>` with Node. A repo without that file runs every tool
 * with `npx --yes <spec>`, as before it existed.
 *
 * The tools run quietly: their output is kept and shown only when they fail, so the person
 * reads one line per step. `--verbose` shows it as it comes.
 */
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { effectiveRunner, readRunnerConfig, RunnerFileError, setTool, toolCommand, toolCommandText, writeRunnerConfig, type Runner, type RunnerConfig } from "@ramon-sg/runner";
import { KitError } from "./output.js";

/** The real path of a folder, or the path itself if it does not exist. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A release version. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
/** An exact semver version: release plus an optional prerelease, no build metadata. */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

/** How long a lookup of the latest version may take before it counts as unknown. */
const LOOKUP_TIMEOUT_MS = 20_000;

/** A release tag in `git ls-remote --tags --refs` output. */
const TAG_REF = /refs\/tags\/v(\d+\.\d+\.\d+)$/;

/** How many lines of a failed tool's output are shown. */
const FAILED_LINES = 25;

/** Whether the tools' output goes straight to the terminal. */
let verbose = false;

/** Lookups already started, by what they look up. */
const lookups = new Map<string, Promise<unknown>>();

/** Downloads already started, by package. */
const downloads = new Map<string, Promise<void>>();

/** What a process printed and how it ended. */
interface Finished {
  status: number | null;
  out: string;
  err: string;
}

/**
 * Shows the tools' output as it comes instead of only when they fail.
 * @param value - True for `--verbose`.
 * @example setVerbose(true)
 */
export function setVerbose(value: boolean): void {
  verbose = value;
}

/**
 * Compares two release versions.
 * @param left - A version like 0.2.0.
 * @param right - Another.
 * @returns Negative if left is older, 0 if equal, positive if newer.
 * @example compareVersions("0.10.0", "0.9.1") // 1
 */
export function compareVersions(left: string, right: string): number {
  const parts = (version: string): number[] => (VERSION.exec(version) ?? []).slice(1).map(Number);
  const [a, b] = [parts(left), parts(right)];
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Whether a version is a release like 1.2.3.
 * @param version - The text.
 * @returns True for a release version.
 * @example isRelease("1.2.3") // true
 */
export function isRelease(version: string): boolean {
  return VERSION.test(version);
}

/**
 * Whether a version is exact semver: a release like 1.2.3, or one with a prerelease like 1.2.3-rc.0.
 * @param version - The text.
 * @returns True for an exact version; ranges, tags and build metadata are not.
 * @example isExactVersion("1.0.0-rc.0") // true
 */
export function isExactVersion(version: string): boolean {
  return SEMVER.test(version);
}

/**
 * Compares two exact versions by semver precedence, prereleases included.
 * @param left - A version like 1.0.0-rc.0.
 * @param right - Another.
 * @returns Negative if left is older, 0 if equal, positive if newer.
 * @example compareSemver("1.0.0-rc.1", "1.0.0") // -1
 */
export function compareSemver(left: string, right: string): number {
  const [a, b] = [SEMVER.exec(left), SEMVER.exec(right)];
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(a?.[index] ?? 0) - Number(b?.[index] ?? 0);
    if (diff !== 0) return diff;
  }
  const [pre, other] = [a?.[4], b?.[4]];
  if (pre === other) return 0;
  if (pre === undefined) return 1;
  if (other === undefined) return -1;
  const [x, y] = [pre.split("."), other.split(".")];
  for (let index = 0; index < Math.min(x.length, y.length); index += 1) {
    const [p, q] = [x[index] as string, y[index] as string];
    if (p === q) continue;
    const [pNumber, qNumber] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (pNumber && qNumber) return Number(p) - Number(q);
    if (pNumber !== qNumber) return pNumber ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.length - y.length;
}

/**
 * Runs a program and collects what it prints.
 * @param program - The program.
 * @param args - Its arguments.
 * @param options - The folder, a time limit, extra variables, and whether its output goes to the terminal.
 * @returns How it ended; status null if it could not start or ran out of time.
 */
function run(program: string, args: string[], options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv; unset?: string[]; inherit?: boolean } = {}): Promise<Finished> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...options.env };
    // A tool in a clone must work in its cwd: agent-cloud-kit prefers this one, and it names the checkout.
    if (options.cwd !== undefined && env.CLAUDE_PROJECT_DIR !== undefined && realPath(env.CLAUDE_PROJECT_DIR) !== realPath(options.cwd)) delete env.CLAUDE_PROJECT_DIR;
    for (const name of options.unset ?? []) delete env[name];
    const child = spawn(program, args, { cwd: options.cwd, env, stdio: options.inherit === true ? "inherit" : ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (err += chunk.toString()));
    const timer = options.timeout === undefined ? undefined : setTimeout(() => child.kill(), options.timeout);
    child.on("error", () => resolve({ status: null, out, err }));
    child.on("close", (code, signal) => {
      if (timer !== undefined) clearTimeout(timer);
      resolve({ status: signal === null ? code : null, out, err });
    });
  });
}

/**
 * Runs a lookup once: later calls get the same promise.
 * @param key - What it looks up.
 * @param lookup - How.
 * @returns Its result.
 */
function once<T>(key: string, lookup: () => Promise<T>): Promise<T> {
  const known = lookups.get(key) as Promise<T> | undefined;
  if (known !== undefined) return known;
  const started = lookup();
  lookups.set(key, started);
  return started;
}

/**
 * The latest version of a package on npm.
 * @param name - The package.
 * @returns The version, or null if npm cannot tell.
 * @example await npmLatest("agent-cloud-kit") // "1.0.0"
 */
export function npmLatest(name: string): Promise<string | null> {
  return once(`npm:${name}`, async () => {
    const version = await npmVersion(name);
    return isRelease(version) ? version : null;
  });
}

/**
 * The `latest` version of a package on npm, even if it is a prerelease like 1.0.0-rc.0.
 * @param name - The package.
 * @returns The version, or null if npm cannot tell or it is not exact semver.
 * @example await npmLatestExact("agent-cloud-kit") // "1.0.0-rc.0"
 */
export function npmLatestExact(name: string): Promise<string | null> {
  return once(`npm-exact:${name}`, async () => {
    const version = await npmVersion(name);
    return isExactVersion(version) ? version : null;
  });
}

/**
 * A package's page on the npm registry (its packument).
 * @param name - The package, scoped or not; a scope's slash goes encoded as npm does.
 * @returns What the registry answers, or null if it cannot be reached, does not answer 200 or does not send JSON.
 */
async function packument(name: string): Promise<Record<string, unknown> | null> {
  const registry = (process.env.AGENT_KITCHEN_REGISTRY || process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/+$/, "");
  try {
    const response = await fetch(`${registry}/${name.replace("/", "%2f")}`, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS), headers: { accept: "application/json" } });
    if (response.status !== 200) return null;
    const found: unknown = await response.json();
    return typeof found === "object" && found !== null && !Array.isArray(found) ? (found as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Whether a value is a plain object. */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The version npm calls `latest`.
 * @param name - The package.
 * @returns The version, or "" if the registry cannot tell.
 */
async function npmVersion(name: string): Promise<string> {
  const tags = (await packument(name))?.["dist-tags"];
  const latest = isRecord(tags) ? tags.latest : undefined;
  return typeof latest === "string" ? latest.trim() : "";
}

/**
 * The dependencies a version of a package declares on npm.
 * @param spec - The package and its version, as `name@x.y.z`.
 * @returns Each dependency's range, or null if npm cannot tell.
 * @example await npmDependencies("@ramon-sg/issue-flow@0.3.0") // { "@ramon-sg/github-rest": "^0.3.0" }
 */
export function npmDependencies(spec: string): Promise<Record<string, string> | null> {
  return once(`npm-deps:${spec}`, async () => {
    const at = spec.lastIndexOf("@");
    if (at <= 0) return null;
    const versions = (await packument(spec.slice(0, at)))?.versions;
    const found = isRecord(versions) ? versions[spec.slice(at + 1)] : undefined;
    if (!isRecord(found)) return null;
    return found.dependencies === undefined ? {} : isRecord(found.dependencies) ? (found.dependencies as Record<string, string>) : null;
  });
}

/**
 * Every version a package has on npm, as its packument lists them.
 * @param name - The package.
 * @returns The versions, in no order, or null if npm cannot tell.
 * @example await npmVersions("@ramon-sg/issue-flow") // ["0.5.1", "0.5.2", "0.6.0"]
 */
export function npmVersions(name: string): Promise<string[] | null> {
  return once(`npm-versions:${name}`, async () => {
    const versions = (await packument(name))?.versions;
    return isRecord(versions) ? Object.keys(versions) : null;
  });
}

/**
 * Every `vX.Y.Z` tag of a GitHub repo.
 * @param repo - The repo, as owner/name.
 * @returns The versions without the `v`, oldest first, or null if git cannot reach it.
 * @example await tagVersions("ramon-sg/agent-skills") // ["0.1.0", "0.2.0"]
 */
export function tagVersions(repo: string): Promise<string[] | null> {
  return once(`tags:${repo}`, async () => {
    const result = await run("git", ["ls-remote", "--tags", "--refs", `https://github.com/${repo}.git`], { timeout: LOOKUP_TIMEOUT_MS, env: { GIT_TERMINAL_PROMPT: "0" } });
    if (result.status !== 0) return null;
    return result.out.split("\n").flatMap((line) => TAG_REF.exec(line.trim())?.slice(1, 2) ?? []).sort(compareVersions);
  });
}

/**
 * The highest `vX.Y.Z` tag of a GitHub repo.
 * @param repo - The repo, as owner/name.
 * @returns The version without the `v`, or null if it has none or git cannot reach it.
 * @example await latestTag("ramon-sg/agent-skills") // "0.1.0"
 */
export async function latestTag(repo: string): Promise<string | null> {
  return (await tagVersions(repo))?.at(-1) ?? null;
}

/**
 * How a repo runs its tools: with the runner its `.agents/runner.json` names (Bun when it names
 * none) and the versions it pins, or, without that file, with npx as before.
 */
export type RepoMode = { kind: "runner"; runner: Runner; tools: Record<string, string> } | { kind: "legacy" };

/** The runner a `--dry-run` on a new repo pretends the repo has, without writing the file. */
let preview: Runner | null = null;

/**
 * Makes `repoMode` answer runner mode, with this runner and no pinned tools, for a repo with no
 * runner.json: what a dry run on a new repo shows is what the real run would do. It is process
 * state, so whoever sets it clears it with null.
 * @param runner - The runner to pretend, or null to stop.
 */
export function previewRunner(runner: Runner | null): void {
  preview = runner;
}

/**
 * How a repo runs its tools. Every read of `.agents/runner.json` goes through here.
 * @param root - The repo.
 * It re-reads the file on every call, so the mode can change in the middle of a run (for example
 * after a tool's apply writes runner.json).
 * @returns Runner mode with its runner and pinned versions, or legacy mode if the repo has no runner.json.
 * @throws KitError If runner.json exists but cannot be used (the one place that turns a RunnerFileError into one).
 * @example repoMode(root) // { kind: "runner", runner: "bun", tools: { "agent-cloud-kit": "1.0.0" } }
 */
export function repoMode(root: string): RepoMode {
  const config = runnerConfig(root);
  if (config === null && preview !== null) return { kind: "runner", runner: preview, tools: {} };
  return config === null ? { kind: "legacy" } : { kind: "runner", runner: effectiveRunner(config), tools: { ...config.tools } };
}

/**
 * Reads `.agents/runner.json`.
 * @param root - The repo.
 * @returns The config, or null if the repo has none.
 * @throws KitError If it exists but cannot be used.
 */
function runnerConfig(root: string): RunnerConfig | null {
  try {
    return readRunnerConfig(root);
  } catch (error) {
    if (error instanceof RunnerFileError) throw new KitError(error.message);
    throw error;
  }
}

/**
 * Adds a tool to `.agents/runner.json` or raises its version there; never lowers it, and
 * writes nothing if it does not change.
 * @param root - The repo, in runner mode.
 * @param pkg - The tool's package.
 * @param version - Its exact version.
 * @returns Whether the file changed.
 * @throws KitError If the repo has no usable runner.json.
 * @example raiseTool(root, "@ramon-sg/github-rest", "0.7.0") // true
 */
export function raiseTool(root: string, pkg: string, version: string): boolean {
  const config = runnerConfig(root);
  if (config === null) throw new KitError(`${root}/.agents/runner.json is missing`);
  const next = setTool(config, pkg, version);
  if (next.changed) writeRunnerConfig(root, next.config);
  return next.changed;
}

/**
 * Writes the runner of `.agents/runner.json`, keeping its tools and everything else in it.
 * @param root - The repo, in runner mode.
 * @param runner - The runner to write.
 * @returns Whether the file changed.
 * @throws KitError If the repo has no usable runner.json.
 * @example setRunner(root, "node") // true
 */
export function setRunner(root: string, runner: Runner): boolean {
  const config = runnerConfig(root);
  if (config === null) throw new KitError(`${root}/.agents/runner.json is missing`);
  if (config.runner === runner) return false;
  writeRunnerConfig(root, { ...config, runner });
  return true;
}

/**
 * Splits a spec into its package and its version, at the last `@` that does not start it.
 * @param spec - The package and its version, as `name@x.y.z` or `@scope/name@x.y.z`.
 * @returns The package and the version.
 * @throws {Error} For a spec without an exact version (a range, a tag, a GitHub spec): a runner takes none of those.
 * @example splitSpec("@ramon-sg/issue-flow@0.2.0") // { pkg: "@ramon-sg/issue-flow", version: "0.2.0" }
 */
function splitSpec(spec: string): { pkg: string; version: string } {
  const at = spec.lastIndexOf("@");
  if (at <= 0 || !isExactVersion(spec.slice(at + 1))) throw new Error(`a runner needs a spec with a version: ${spec}`);
  return { pkg: spec.slice(0, at), version: spec.slice(at + 1) };
}

/**
 * The program and arguments that run a tool in the repo.
 * @param root - The repo.
 * @param args - The spec and the tool's arguments.
 * @returns `npx --yes <args>` in legacy mode, else the runner's command.
 * @throws {Error} In runner mode, for a spec without an exact version.
 */
function toolInvocation(root: string, args: string[]): { file: string; args: string[] } {
  const mode = repoMode(root);
  const [spec = "", ...rest] = args;
  if (mode.kind === "legacy") return { file: "npx", args: ["--yes", ...args] };
  const { pkg, version } = splitSpec(spec);
  return toolCommand(mode.runner, pkg, version, rest);
}

/**
 * The command that runs a tool in the repo, to show to the person so they can run it by hand.
 * @param root - The repo.
 * @param args - The spec and the tool's arguments.
 * @returns `npx <args>` in legacy mode, else the runner's command, quoted for a shell.
 * @example toolText(root, ["agent-cloud-kit@1.1.0", "init"]) // "bun x --bun agent-cloud-kit@1.1.0 init"
 */
export function toolText(root: string, args: string[]): string {
  const mode = repoMode(root);
  const [spec = "", ...rest] = args;
  if (mode.kind === "legacy") return `npx ${args.join(" ")}`;
  const { pkg, version } = splitSpec(spec);
  return toolCommandText(mode.runner, pkg, version, rest);
}

/**
 * Downloads a package into npx's cache without running it, once per package, so its step
 * starts at once. A failed download is ignored: the step itself will say what failed. With Bun
 * it does nothing: Bun cannot fill its cache without running the tool.
 * @param root - The repo.
 * @param spec - The package and its version.
 * @returns When it is done.
 * @example void download(root, "agent-cloud-kit@1.0.0")
 */
export function download(root: string, spec: string): Promise<void> {
  const mode = repoMode(root);
  if (mode.kind === "runner") {
    splitSpec(spec);
    if (mode.runner === "bun") return Promise.resolve();
  }
  const known = downloads.get(spec);
  if (known !== undefined) return known;
  const started = run("npx", ["--yes", "--package", spec, "--", "node", "-e", ""], { cwd: root }).then(() => undefined);
  downloads.set(spec, started);
  return started;
}

/** How a tool ended, and what it printed if it was kept. */
export interface ToolRun {
  ok: boolean;
  output: string;
}

/**
 * Runs a tool in the repo with its runner: quietly, or with its output on the terminal with
 * `--verbose`. It must not ask anything: the person answered before the steps ran.
 * @param root - The repo.
 * @param args - The package and its arguments.
 * @param env - Variables added to the environment, such as the tool's language.
 * @returns Whether it exited 0, and what it printed.
 * @example await runTool(root, ["agent-cloud-kit@1.0.0", "init"])
 */
export async function runTool(root: string, args: string[], env?: NodeJS.ProcessEnv): Promise<ToolRun> {
  const command = toolInvocation(root, args);
  const result = await run(command.file, command.args, { cwd: root, inherit: verbose, env });
  return { ok: result.status === 0, output: `${result.out}${result.err}` };
}

/**
 * The end of a failed tool's output, indented, to show under its step.
 * @param output - What it printed.
 * @returns Its last lines, or an empty text.
 * @example failedOutput("npm error 404\n") // "    npm error 404\n"
 */
export function failedOutput(output: string): string {
  const lines = output.trimEnd().split("\n").filter((line) => line.trim() !== "");
  return lines.slice(-FAILED_LINES).map((line) => `    ${line}\n`).join("");
}

/**
 * Runs a tool in the repo with its runner and returns what it printed.
 * @param root - The repo.
 * @param args - The package and its arguments.
 * @param lookup - True to give up after the lookups' time limit, for a read that only informs.
 * @param env - Variables added to the environment, such as the tool's language.
 * @returns Its stdout, stderr and exit code, or null if the runner could not start.
 * @example await captureTool(root, ["@ramon-sg/issue-flow@0.2.0", "doctor", "--json"])
 */
export async function captureTool(root: string, args: string[], lookup = false, env?: NodeJS.ProcessEnv): Promise<{ out: string; err: string; status: number | null } | null> {
  const command = toolInvocation(root, args);
  const result = await run(command.file, command.args, { cwd: root, env, ...(lookup ? { timeout: LOOKUP_TIMEOUT_MS } : {}) });
  return result.status === null && result.out === "" ? null : { out: result.out, err: result.err, status: result.status };
}

/**
 * Runs the repo's package manager's install: quietly, or with its output on the terminal
 * with `--verbose`.
 * @param root - The repo.
 * @param manager - `npm`, `pnpm`, `bun` or `yarn`.
 * @returns Whether it worked and, if it ran quietly, what it printed.
 * @example await runInstall(root, "pnpm")
 */
export async function runInstall(root: string, manager: string): Promise<ToolRun> {
  const result = await run(manager, ["install"], { cwd: root, inherit: verbose });
  return { ok: result.status === 0, output: `${result.out}${result.err}` };
}

/**
 * Runs a tool in the repo with its runner, without some variables of the environment, and
 * returns what it printed.
 * @param root - The repo.
 * @param args - The package and its arguments.
 * @param unset - The variables left out.
 * @returns Its stdout, stderr and exit code.
 * @example await captureToolWithout(root, ["@ramon-sg/github-rest@0.3.0", "pr", "create"], ["GH_REPO"])
 */
export async function captureToolWithout(root: string, args: string[], unset: string[]): Promise<{ out: string; err: string; status: number | null }> {
  const command = toolInvocation(root, args);
  return run(command.file, command.args, { cwd: root, unset });
}
