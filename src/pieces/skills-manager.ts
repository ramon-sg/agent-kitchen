/**
 * @file The version of `skills-manager` in the repo's package.json. agent-kitchen runs it to
 * install and move the skills, so agent-kitchen is the one that knows the oldest version it
 * works with: it adds it when missing and raises an exact version below it, never lowers
 * one. A range or `workspace:` is the repo's own choice: it is left alone, with a warning if
 * the version it runs is too old. Only in a repo that uses skills and has package.json, or
 * gets one in this run from the flow's install: then the step makes package.json first, and
 * the flow's `apply`, which never adds skills-manager, adds its own packages to it.
 *
 * In runner mode the version is the one `.agents/runner.json` pins, and the piece takes it to
 * npm's latest: it runs that version's `install` (which, with a manifest, raises its own entry),
 * pins it in runner.json if it is still missing or behind, and writes or re-pins the
 * `SessionStart` hook of `session-notice` with the runner's command, which skills-manager
 * itself never writes.
 */
import { toolCommandText } from "@ramon-sg/runner";
import { type Check, type Context, type PieceStatus, SKILLS_MANAGER, SKILLS_MANIFEST } from "../piece.js";
import { dependencyVersion, installedVersion, isObject, readJson, setDependency, writeJson } from "../repo.js";
import { offeredVersion, RUNNER_MINIMUMS, toolVersion } from "../runner-mode.js";
import { compareSemver, compareVersions, isRelease, raiseTool, repoMode, runTool, toolText } from "../tools.js";
import { ui } from "../texts/index.js";
import type { StepText } from "../texts/step-text.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "skills-manager";

/** The oldest `skills-manager` agent-kitchen works with: the first with `--replace`. */
export const MIN_VERSION = "1.2.0";

/** What package.json has of skills-manager. */
type Pinned = { kind: "missing" } | { kind: "exact"; version: string } | { kind: "other"; spec: string; runs: string | null };

/**
 * What package.json has of skills-manager and, for a range, the version that runs: the one
 * in node_modules, or the first x.y.z of the range.
 * @param root - The repo.
 * @returns What it has.
 */
function pinned(root: string): Pinned {
  const spec = dependencyVersion(readJson(root, "package.json"), SKILLS_MANAGER);
  if (spec === null) return { kind: "missing" };
  if (isRelease(spec)) return { kind: "exact", version: spec };
  const floor = spec.startsWith("workspace:") ? null : (/\d+\.\d+\.\d+/.exec(spec)?.[0] ?? null);
  return { kind: "other", spec, runs: installedVersion(root, SKILLS_MANAGER) ?? floor };
}

/**
 * Whether a version is older than the one agent-kitchen needs.
 * @param version - The version.
 * @returns True if it is below the minimum.
 */
function below(version: string): boolean {
  return compareVersions(version, MIN_VERSION) < 0;
}

/**
 * Whether the piece applies: the repo uses skills, or this run may install them, and it has
 * package.json or the flow's install is about to make one.
 * @param root - The repo.
 * @param withSkills - Whether this run may install skills (`skills` is not left out).
 * @param flowComing - Whether this run installs the flow.
 * @returns True if it applies.
 */
function applies(root: string, withSkills: boolean, flowComing: boolean): boolean {
  return (flowComing || readJson(root, "package.json") !== null) && (withSkills || readJson(root, SKILLS_MANIFEST) !== null);
}

/** Claude Code's settings, where the `session-notice` hook goes. */
const SETTINGS = ".claude/settings.json";

/** A command of skills-manager's `session-notice`, in any of the forms it was written. */
const SESSION_NOTICE = /skills-manager(@\S+)?\s+session-notice/;

/**
 * The commands of the repo's `SessionStart` hooks that run `session-notice`.
 * @param root - The repo.
 * @returns The commands, in any form they were written.
 * @example sessionNoticeCommands(root) // ["npx @ramon-sg/skills-manager session-notice"]
 */
export function sessionNoticeCommands(root: string): string[] {
  const hooks = readJson(root, SETTINGS)?.hooks;
  const groups: unknown[] = isObject(hooks) && Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  return groups.flatMap((group) => (isObject(group) && Array.isArray(group.hooks) ? group.hooks : []))
    .flatMap((hook: unknown) => (isObject(hook) && typeof hook.command === "string" && SESSION_NOTICE.test(hook.command) ? [hook.command] : []));
}

/**
 * Writes the `SessionStart` hook of `session-notice` with a command, or re-pins the one the
 * repo has; the other hooks stay as they are.
 * @param root - The repo.
 * @param command - The hook's command.
 * @returns Whether the settings changed.
 * @example pinSessionNotice(root, "bunx --bun @ramon-sg/skills-manager@1.5.1 session-notice") // true
 */
export function pinSessionNotice(root: string, command: string): boolean {
  const settings = readJson(root, SETTINGS) ?? {};
  const hooks = isObject(settings.hooks) ? settings.hooks : {};
  const groups: unknown[] = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  let found = false;
  const pinned = groups.map((group) => {
    if (!isObject(group) || !Array.isArray(group.hooks)) return group;
    return { ...group, hooks: group.hooks.map((hook: unknown) => {
      if (!isObject(hook) || typeof hook.command !== "string" || !SESSION_NOTICE.test(hook.command)) return hook;
      found = true;
      return { ...hook, command };
    }) };
  });
  const next = found ? pinned : [...groups, { hooks: [{ type: "command", command }] }];
  if (JSON.stringify(next) === JSON.stringify(groups)) return false;
  writeJson(root, SETTINGS, { ...settings, hooks: { ...hooks, SessionStart: next } });
  return true;
}

/**
 * In runner mode, takes skills-manager to a version: runs that version's `install` if the repo
 * has a manifest (it raises its own entry), pins it in runner.json if it is still missing or
 * behind, and writes or re-pins the `SessionStart` hook of `session-notice`.
 * @param context - Where it runs, in runner mode.
 * @param version - The version.
 * @returns Whether its install worked.
 * @throws KitError If the repo has no usable runner.json.
 */
export async function updateInRunner(context: Context, version: string): Promise<boolean> {
  const common = ui.pieces.common;
  const spec = `${SKILLS_MANAGER}@${version}`;
  if (readJson(context.root, SKILLS_MANIFEST) !== null) {
    const run = await runTool(context.root, [spec, "install"]);
    if (!run.ok) {
      context.fail(common.failed("skills-manager install", toolText(context.root, [spec, "install"])), run.output);
      return false;
    }
  }
  raiseTool(context.root, SKILLS_MANAGER, version);
  context.note(common.inRunner(SKILLS_MANAGER, version));
  const mode = repoMode(context.root);
  const command = toolCommandText(mode.kind === "runner" ? mode.runner : "bun", SKILLS_MANAGER, version, ["session-notice"]);
  if (pinSessionNotice(context.root, command)) context.note(ui.pieces.skillsManager.hookPinned(command));
  return true;
}

/**
 * In runner mode, what the repo has of skills-manager and the step that takes it to npm's
 * latest. It applies where the repo uses skills or this run may install them.
 * @param root - The repo, in runner mode.
 * @param withSkills - Whether this run may install skills.
 * @returns The piece's status, or null where the piece does not apply.
 */
async function runnerStatus(root: string, withSkills: boolean): Promise<PieceStatus | null> {
  if (!withSkills && readJson(root, SKILLS_MANIFEST) === null) return null;
  const said = ui.pieces.skillsManager;
  const common = ui.pieces.common;
  const installed = toolVersion(root, SKILLS_MANAGER);
  const latest = await offeredVersion(root, SKILLS_MANAGER);
  const base = { name: NAME, summary: said.summary, installed: installed !== null };
  if (latest === null) return { ...base, state: `${installed === null ? said.missingInRunner : common.upToDate(installed)}${common.npmDown}`, steps: [] };
  if (installed !== null && compareSemver(latest, installed) <= 0) return { ...base, state: common.upToDate(installed), steps: [] };
  const spec = `${SKILLS_MANAGER}@${latest}`;
  const step = {
    piece: NAME,
    checked: true,
    downloads: [spec],
    text: installed === null ? ({ kind: "skills-manager-pin", version: latest } as const) : ({ kind: "skills-manager-update", from: installed, to: latest } as const),
    run: (context: Context) => updateInRunner(context, latest),
  };
  return { ...base, state: installed === null ? said.missingInRunner : common.behind(installed, latest), steps: [step] };
}

/**
 * What the repo has of skills-manager, and the step that raises it, if any. The step reads
 * package.json (in runner mode, runner.json) again when it runs.
 * @param root - The repo.
 * @param withSkills - Whether this run may install skills.
 * @param flowComing - Whether this run installs the flow, which makes package.json if missing.
 * @returns The piece's status, or null where the piece does not apply.
 * @example (await skillsManagerStatus(root, true, false))?.state // "1.1.0, bajo 1.2.0"
 */
export async function skillsManagerStatus(root: string, withSkills: boolean, flowComing: boolean): Promise<PieceStatus | null> {
  if (repoMode(root).kind === "runner") return runnerStatus(root, withSkills);
  if (!applies(root, withSkills, flowComing)) return null;
  const said = ui.pieces.skillsManager;
  const common = ui.pieces.common;
  const summary = said.summary;
  if (readJson(root, "package.json") === null) {
    const make = {
      piece: NAME,
      checked: true,
      downloads: [`${SKILLS_MANAGER}@${MIN_VERSION}`],
      text: { kind: "skills-manager-create", version: MIN_VERSION } as const,
      run: async (context: Context) => {
        if (readJson(context.root, "package.json") === null) writeJson(context.root, "package.json", { private: true, devDependencies: { [SKILLS_MANAGER]: MIN_VERSION } });
        else if (pinned(context.root).kind === "missing") setDependency(context.root, SKILLS_MANAGER, MIN_VERSION);
        context.note(ui.pieces.common.inPackage(SKILLS_MANAGER, MIN_VERSION));
        return true;
      },
    };
    return { name: NAME, summary, installed: false, state: said.noPackage, steps: [make] };
  }
  const now = pinned(root);
  if (now.kind === "other") {
    const old = now.runs !== null && below(now.runs) ? now.runs : null;
    return { name: NAME, summary, installed: true, state: said.rangeKept(now.spec, old, MIN_VERSION), steps: [] };
  }
  if (now.kind === "exact" && !below(now.version)) return { name: NAME, summary, installed: true, state: common.upToDate(now.version), steps: [] };
  const text: StepText = now.kind === "missing" ? { kind: "skills-manager-add", version: MIN_VERSION } : { kind: "skills-manager-bump", from: now.version, to: MIN_VERSION };
  const state = now.kind === "missing" ? said.missing : said.below(now.version, MIN_VERSION);
  const step = {
    piece: NAME,
    checked: true,
    downloads: [`${SKILLS_MANAGER}@${MIN_VERSION}`],
    text,
    run: async (context: Context) => {
      const current = pinned(context.root);
      if (current.kind === "missing" || (current.kind === "exact" && below(current.version))) {
        setDependency(context.root, SKILLS_MANAGER, MIN_VERSION);
        context.note(ui.pieces.common.inPackage(SKILLS_MANAGER, MIN_VERSION));
      } else context.note(ui.pieces.common.alreadyFine);
      return true;
    },
  };
  return { name: NAME, summary, installed: now.kind !== "missing", state, steps: [step] };
}

/**
 * Whether the version of skills-manager the repo runs is the one agent-kitchen needs.
 * @param root - The repo.
 * @returns The checks; none where the piece does not apply.
 * @example skillsManagerChecks(root)[0]?.status // "ok"
 */
export function skillsManagerChecks(root: string): Check[] {
  const said = ui.pieces.skillsManager;
  if (repoMode(root).kind === "runner") {
    if (readJson(root, SKILLS_MANIFEST) === null) return [];
    const version = toolVersion(root, SKILLS_MANAGER);
    const minimum = RUNNER_MINIMUMS[SKILLS_MANAGER] as string;
    if (version === null) return [{ name: NAME, status: "info", detail: said.checkMissingInRunner }];
    return compareSemver(version, minimum) < 0
      ? [{ name: NAME, status: "fail", detail: said.checkBelow(version, minimum) }]
      : [{ name: NAME, status: "ok", detail: said.checkOk(version, minimum) }];
  }
  if (!applies(root, false, false)) return [];
  const now = pinned(root);
  if (now.kind === "missing") return [{ name: NAME, status: "info", detail: said.checkMissing(MIN_VERSION) }];
  if (now.kind === "exact")
    return below(now.version)
      ? [{ name: NAME, status: "fail", detail: said.checkBelow(now.version, MIN_VERSION) }]
      : [{ name: NAME, status: "ok", detail: said.checkOk(now.version, MIN_VERSION) }];
  if (now.runs !== null && below(now.runs)) return [{ name: NAME, status: "fail", detail: said.checkRangeBelow(now.spec, now.runs, MIN_VERSION) }];
  return [{ name: NAME, status: "ok", detail: said.checkRange(now.spec, now.runs) }];
}
