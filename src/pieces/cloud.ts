/**
 * @file Claude cloud sessions (`agent-cloud-kit`). The repo's version is the one
 * `.agents/runner.json` pins or, in a legacy repo, the one `.claude/cloud.json` pins: the cloud
 * machine runs exactly that one. Installing runs its `init`; updating runs the new version's
 * `init`, so the `cloud-ready` skill copied into the repo matches it (`init` is idempotent: it
 * adds no second hook and keeps `.claude/cloud.json`). In runner mode `init` raises its own
 * entry in runner.json; in a legacy repo agent-kitchen first moves the version in
 * `.claude/cloud.json` (and a `$schema` pinned to a version), and only to versions below 1.0.0,
 * the first that reads runner.json. Outside the cloud its hook does nothing, so a repo nobody
 * opens in the cloud loses nothing.
 */
import { RUNNER_FILE } from "@ramon-sg/runner";
import type { Check, Context, PieceStatus, Step } from "../piece.js";
import { readJson, writeJson } from "../repo.js";
import { CLOUD_CONFIG, CLOUD_PACKAGE, offeredVersion, toolVersion } from "../runner-mode.js";
import { ui } from "../texts/index.js";
import { compareSemver, repoMode, runTool, toolText } from "../tools.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "agent-cloud-kit";

/** The package on npm. */
export const PACKAGE = CLOUD_PACKAGE;

/** Its config in the repo, which pins its version in a legacy repo. */
const CONFIG = CLOUD_CONFIG;

/**
 * Runs a version's `init`.
 * @param context - Where it runs.
 * @param version - The version.
 * @returns Whether it worked.
 */
async function init(context: Context, version: string): Promise<boolean> {
  const spec = `${PACKAGE}@${version}`;
  const run = await runTool(context.root, [spec, "init"]);
  if (run.ok) return true;
  context.fail(ui.pieces.common.failed("agent-cloud-kit init", toolText(context.root, [spec, "init"])), run.output);
  return false;
}

/**
 * Moves a `$schema` pinned to a version of agent-cloud-kit in `.claude/cloud.json` to another
 * version and, in a legacy repo, the pinned version too.
 * @param root - The repo.
 * @param version - The new version.
 * @param pin - Whether to write `version` (legacy mode).
 */
function moveConfig(root: string, version: string, pin: boolean): void {
  const current = readJson(root, CONFIG);
  if (current === null && !pin) return;
  const config = current ?? {};
  const schema = typeof config.$schema === "string" ? config.$schema.replace(/\/agent-cloud-kit@[^/]+\//, `/${PACKAGE}@${version}/`) : undefined;
  const next = { ...config, ...(schema === undefined ? {} : { $schema: schema }), ...(pin ? { version } : {}) };
  if (JSON.stringify(next) !== JSON.stringify(current)) writeJson(root, CONFIG, next);
}

/**
 * The step the repo needs, if any.
 * @param installed - Whether the repo has agent-cloud-kit.
 * @param version - The version it pins, or null.
 * @param latest - The version it may go to, or null if unknown.
 * @param legacy - Whether the version lives in `.claude/cloud.json`.
 * @returns The step, or null.
 */
function stepFor(installed: boolean, version: string | null, latest: string | null, legacy: boolean): Step | null {
  if (latest === null) return null;
  if (!installed) return { piece: NAME, checked: true, downloads: [`${PACKAGE}@${latest}`], text: { kind: "cloud-install", version: latest }, run: (context) => init(context, latest) };
  if (version !== null && compareSemver(latest, version) <= 0) return null;
  return {
    piece: NAME,
    checked: true,
    downloads: [`${PACKAGE}@${latest}`],
    text: { kind: "cloud-update", from: version, to: latest, config: legacy ? CONFIG : RUNNER_FILE },
    run: (context) => {
      moveConfig(context.root, latest, legacy);
      return init(context, latest);
    },
  };
}

/**
 * Whether the repo has agent-cloud-kit, and the version it pins.
 * @param root - The repo.
 * @returns Both.
 */
function pinned(root: string): { installed: boolean; version: string | null; legacy: boolean } {
  const legacy = repoMode(root).kind === "legacy";
  const version = toolVersion(root, PACKAGE);
  return { installed: readJson(root, CONFIG) !== null || (!legacy && version !== null), version, legacy };
}

/**
 * What the repo has of agent-cloud-kit, and the step it needs.
 * @param root - The repo.
 * @returns The piece's status.
 * @example (await cloudStatus(root)).state // "1.0.0, al día"
 */
export async function cloudStatus(root: string): Promise<PieceStatus> {
  const { installed, version, legacy } = pinned(root);
  const latest = await offeredVersion(root, PACKAGE);
  const step = stepFor(installed, version, latest, legacy);
  const said = ui.pieces.common;
  const known = latest === null ? said.npmDown : "";
  const state = !installed ? `${said.notInstalled}${known}` : version === null ? ui.pieces.cloud.unpinned(legacy ? CONFIG : RUNNER_FILE) : step === null ? `${said.upToDate(version)}${known}` : said.behind(version, latest ?? "?");
  return { name: NAME, summary: ui.pieces.cloud.summary, installed, state, steps: step === null ? [] : [step] };
}

/**
 * Whether the repo pins a version, and whether a newer one it may go to exists.
 * @param root - The repo.
 * @returns The checks.
 * @example (await cloudChecks(root))[0].status // "ok"
 */
export async function cloudChecks(root: string): Promise<Check[]> {
  const { installed, version, legacy } = pinned(root);
  if (!installed) return [{ name: NAME, status: "info", detail: ui.pieces.common.notInstalled }];
  const latest = await offeredVersion(root, PACKAGE);
  if (version === null) return [{ name: NAME, status: "fail", detail: legacy ? ui.pieces.cloud.checkUnpinned(CONFIG, latest ?? "1.0.0") : ui.pieces.cloud.checkUnpinnedInRunner(RUNNER_FILE) }];
  if (latest !== null && compareSemver(latest, version) > 0) return [{ name: NAME, status: "info", detail: ui.pieces.common.behindRun(version, latest) }];
  return [{ name: NAME, status: "ok", detail: version }];
}
