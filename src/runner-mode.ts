/**
 * @file Where each tool's version comes from, and which version a repo may go to. In runner
 * mode (the repo has `.agents/runner.json`) the versions are the ones that file pins and a tool
 * goes to its latest release. In legacy mode they come from where they always did
 * (`package.json`, `.claude/cloud.json`, the guard's manifest), and a tool only goes as far as
 * the newest version below the first one that reads `runner.json`: a newer one would move that
 * tool alone to runner mode, and the move is all the tools at once or none.
 */
import { FLOW_PACKAGE, SKILLS_MANAGER } from "./piece.js";
import { dependencyVersion, readJson } from "./repo.js";
import { compareSemver, isExactVersion, isRelease, npmLatest, npmLatestExact, npmVersions, repoMode, tagVersions } from "./tools.js";

/** claude-repo-guard on npm, from 0.8.0 on. */
export const GUARD_PACKAGE = "@ramon-sg/claude-repo-guard";

/** claude-repo-guard on GitHub, where legacy repos run it from at a `vX.Y.Z` tag. */
export const GUARD_REPO = "ramon-sg/claude-repo-guard";

/** agent-cloud-kit on npm (unscoped: it is its own). */
export const CLOUD_PACKAGE = "agent-cloud-kit";

/** The client of GitHub's REST API that the flow's skills call. */
export const GITHUB_REST = "@ramon-sg/github-rest";

/** Where a legacy repo pins agent-cloud-kit. */
export const CLOUD_CONFIG = ".claude/cloud.json";

/** What the guard's install records, with its version in a legacy repo. */
export const GUARD_MANIFEST = ".claude/repo-guard.manifest.json";

/** Each tool's first version that reads `.agents/runner.json`. */
export const RUNNER_MINIMUMS: Record<string, string> = {
  [FLOW_PACKAGE]: "0.6.0",
  [SKILLS_MANAGER]: "1.5.0",
  [GUARD_PACKAGE]: "0.8.0",
  [CLOUD_PACKAGE]: "1.0.0",
};

/**
 * A tool's version in the repo: in runner mode, the one `runner.json` pins; in legacy mode,
 * the exact one `package.json`, `.claude/cloud.json` or the guard's manifest has.
 * @param root - The repo.
 * @param pkg - The tool's package.
 * @returns The version, or null if the repo pins none (or not an exact one).
 * @example toolVersion(root, "@ramon-sg/issue-flow") // "0.6.0"
 */
export function toolVersion(root: string, pkg: string): string | null {
  const mode = repoMode(root);
  if (mode.kind === "runner") return mode.tools[pkg] ?? null;
  if (pkg === CLOUD_PACKAGE) {
    const version = readJson(root, CLOUD_CONFIG)?.version;
    return typeof version === "string" && isExactVersion(version) ? version : null;
  }
  if (pkg === GUARD_PACKAGE) {
    const version = readJson(root, GUARD_MANIFEST)?.version;
    return typeof version === "string" && isRelease(version) ? version : null;
  }
  const version = dependencyVersion(readJson(root, "package.json"), pkg);
  return version !== null && isExactVersion(version) ? version : null;
}

/**
 * The ceiling of a tool in a legacy repo: its first version that reads `runner.json`. A legacy
 * repo is offered only versions below it.
 * @param pkg - The tool's package.
 * @returns The version, excluded.
 * @throws {Error} For a package without a minimum.
 * @example legacyCeiling("@ramon-sg/issue-flow") // "0.6.0"
 */
export function legacyCeiling(pkg: string): string {
  const minimum = RUNNER_MINIMUMS[pkg];
  if (minimum === undefined) throw new Error(`no runner minimum for ${pkg}`);
  return minimum;
}

/**
 * The newest version of a tool a legacy repo may go to: npm's latest if it is below the
 * ceiling, else the newest version below it that npm lists (for the guard, the newest tag
 * below it). agent-cloud-kit counts prereleases, as its pin always did; the rest, releases.
 * @param pkg - The tool's package.
 * @returns The version, or null if there is none or the registry cannot tell.
 * @example await legacyLatest("@ramon-sg/issue-flow") // "0.5.2"
 */
export async function legacyLatest(pkg: string): Promise<string | null> {
  const ceiling = legacyCeiling(pkg);
  const below = (version: string): boolean => compareSemver(version, ceiling) < 0;
  if (pkg === GUARD_PACKAGE) return (await tagVersions(GUARD_REPO))?.filter(below).at(-1) ?? null;
  const prereleases = pkg === CLOUD_PACKAGE;
  const latest = await (prereleases ? npmLatestExact(pkg) : npmLatest(pkg));
  if (latest !== null && below(latest)) return latest;
  const versions = await npmVersions(pkg);
  const fits = (version: string): boolean => (prereleases ? isExactVersion(version) : isRelease(version)) && below(version) && (latest === null || compareSemver(version, latest) <= 0);
  return versions?.filter(fits).sort(compareSemver).at(-1) ?? null;
}

/**
 * The version of a tool the repo may go to: its latest in runner mode (the guard's from npm),
 * the newest below its ceiling in legacy mode.
 * @param root - The repo.
 * @param pkg - The tool's package.
 * @returns The version, or null if the registry (or GitHub) cannot tell.
 * @example await offeredVersion(root, "agent-cloud-kit") // "1.0.0"
 */
export function offeredVersion(root: string, pkg: string): Promise<string | null> {
  if (repoMode(root).kind === "legacy") return legacyLatest(pkg);
  return pkg === CLOUD_PACKAGE ? npmLatestExact(pkg) : npmLatest(pkg);
}
