/**
 * @file The repo agent-kitchen works on: its main checkout (never a worktree, whose files are
 * not the ones the team commits from), the JSON files the pieces keep in it, and its
 * package manager.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KitError } from "./output.js";
import { ui } from "./texts/index.js";

/**
 * Whether a value is a plain JSON object.
 * @param value - The value.
 * @returns True for an object that is not an array nor null.
 * @example isObject({}) // true
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runs git in a folder.
 * @param cwd - The folder.
 * @param args - The arguments.
 * @returns Its trimmed stdout, or null if it failed.
 */
function git(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * The main checkout of the repo a folder is in.
 * @param cwd - The folder.
 * @param command - The command that runs, for the error.
 * @returns Its root, with symlinks resolved.
 * @throws KitError outside a git checkout or inside a worktree.
 * @example mainCheckout(process.cwd(), "agent-kitchen") // "/code/shop"
 */
export function mainCheckout(cwd: string, command: string): string {
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (common === null || top === null) throw new KitError(ui.repo.outside(command));
  const main = realpathSync(dirname(common));
  if (realpathSync(top) !== main) throw new KitError(ui.repo.worktree(command, main));
  return main;
}

/**
 * Reads a JSON object of the repo.
 * @param root - The repo.
 * @param path - The file, relative to the repo.
 * @returns The object, or null if the file does not exist.
 * @throws KitError if it is not valid JSON or not an object: it is never overwritten then.
 * @example readJson(root, ".claude/cloud.json")
 */
export function readJson(root: string, path: string): Record<string, unknown> | null {
  const file = join(root, path);
  if (!existsSync(file)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new KitError(ui.repo.badJson(path, error instanceof Error ? error.message : String(error)));
  }
  if (!isObject(value)) throw new KitError(ui.repo.notObject(path));
  return value;
}

/**
 * Writes a JSON file of the repo, indented by two spaces, creating its folder.
 * @param root - The repo.
 * @param path - The file, relative to the repo.
 * @param value - What to write.
 * @example writeJson(root, ".claude/cloud.json", { version: "1.1.0" })
 */
export function writeJson(root: string, path: string, value: unknown): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * The version of a dependency in `package.json`, development or not.
 * @param pkg - The package.json, or null.
 * @param name - The package.
 * @returns The version, or null if it is not there.
 * @example dependencyVersion(pkg, "@ramon-sg/issue-flow") // "0.2.0"
 */
export function dependencyVersion(pkg: Record<string, unknown> | null, name: string): string | null {
  for (const field of ["devDependencies", "dependencies"]) {
    const deps = pkg?.[field];
    if (isObject(deps) && typeof deps[name] === "string") return deps[name];
  }
  return null;
}

/** The tools of the ecosystem: dependencies of a repo that only run them, not code of its own. */
export const ECOSYSTEM_TOOLS = ["@ramon-sg/issue-flow", "@ramon-sg/github-rest", "@ramon-sg/skills-manager", "@ramon-sg/claude-repo-guard", "agent-cloud-kit"];

/**
 * What the repo itself needs installed: the names in `dependencies`, `devDependencies`,
 * `optionalDependencies` and `peerDependencies` that are not tools of the ecosystem, and
 * `workspaces` if it has any, since its packages have dependencies of their own.
 * @param root - The repo.
 * @returns The names (and "workspaces"); none without package.json.
 * @example ownDependencies(root) // ["react"]
 */
export function ownDependencies(root: string): string[] {
  const pkg = readJson(root, "package.json");
  const keys = (field: string): string[] => (isObject(pkg?.[field]) ? Object.keys(pkg[field]) : []);
  const workspaces = pkg?.workspaces;
  const hasWorkspaces = Array.isArray(workspaces) ? workspaces.length > 0 : isObject(workspaces) && Array.isArray(workspaces.packages) && workspaces.packages.length > 0;
  const names = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap(keys).filter((name) => !ECOSYSTEM_TOOLS.includes(name));
  return [...new Set([...names, ...(hasWorkspaces ? ["workspaces"] : [])])];
}

/** The fields of package.json that hold dependencies. */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/**
 * Every dependency entry a package.json has, ecosystem tools included, and "workspaces" if it has
 * any: whether the repo needs its lockfile and node_modules at all.
 * @param pkg - The package.json, or null.
 * @param without - Entries about to go, and the fields they go from.
 * @returns The entries, as `<field>:<name>` (and "workspaces").
 * @example dependencyEntries({ dependencies: { react: "19.0.0" } }) // ["dependencies:react"]
 */
export function dependencyEntries(pkg: Record<string, unknown> | null, without: { names: string[]; fields: string[] } = { names: [], fields: [] }): string[] {
  const entries = DEPENDENCY_FIELDS.flatMap((field) => {
    const deps = pkg?.[field];
    if (!isObject(deps)) return [];
    return Object.keys(deps).filter((name) => !(without.fields.includes(field) && without.names.includes(name))).map((name) => `${field}:${name}`);
  });
  const workspaces = pkg?.workspaces;
  const hasWorkspaces = Array.isArray(workspaces) ? workspaces.length > 0 : isObject(workspaces) && Array.isArray(workspaces.packages) && workspaces.packages.length > 0;
  return hasWorkspaces ? [...entries, "workspaces"] : entries;
}

/** The lockfile of each package manager, in the order they are looked for. */
const LOCKFILES: [string, string][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/**
 * The repo's package manager: the `packageManager` field, then its lockfile, then npm.
 * @param root - The repo.
 * @returns `npm`, `pnpm`, `bun` or `yarn`.
 * @example packageManager(root) // "pnpm"
 */
export function packageManager(root: string): string {
  const pkg = readJson(root, "package.json");
  const field = typeof pkg?.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined;
  if (field !== undefined && field !== "") return field;
  return LOCKFILES.find(([file]) => existsSync(join(root, file)))?.[1] ?? "npm";
}

/**
 * The lockfiles the repo has, of any package manager.
 * @param root - The repo.
 * @returns Their names, relative to the repo.
 * @example lockfiles(root) // ["package-lock.json"]
 */
export function lockfiles(root: string): string[] {
  return LOCKFILES.map(([file]) => file).filter((file) => existsSync(join(root, file)));
}

/**
 * Changes package.json and writes it back as it was written: same indentation, line endings
 * and final newline. Nothing is written if the change leaves it equal.
 * @param root - The repo.
 * @param edit - Changes the parsed file in place.
 * @returns Whether the file changed; false without package.json.
 * @example editPackage(root, (pkg) => delete pkg.devDependencies) // true
 */
export function editPackage(root: string, edit: (pkg: Record<string, unknown>) => void): boolean {
  const pkg = readJson(root, "package.json");
  if (pkg === null) return false;
  const before = JSON.stringify(pkg);
  edit(pkg);
  if (JSON.stringify(pkg) === before) return false;
  writePackage(root, pkg);
  return true;
}

/**
 * Writes package.json with the indentation, line endings and final newline its text has now.
 * @param root - The repo.
 * @param pkg - The new content.
 */
function writePackage(root: string, pkg: Record<string, unknown>): void {
  const text = readFileSync(join(root, "package.json"), "utf8");
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const json = JSON.stringify(pkg, null, indent).replace(/\n/g, eol);
  writeFileSync(join(root, "package.json"), /\r?\n$/.test(text) || text === "" ? `${json}${eol}` : json);
}

/**
 * The text of the repo's package.json, to tell later whether a run changed it.
 * @param root - The repo.
 * @returns Its text, or null if there is none.
 * @example packageText(root) // '{ "devDependencies": … }'
 */
export function packageText(root: string): string | null {
  const file = join(root, "package.json");
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/**
 * The version of a package installed in the repo's `node_modules`.
 * @param root - The repo.
 * @param name - The package.
 * @returns Its version, or null if it is not installed.
 * @example installedVersion(root, "@ramon-sg/skills-manager") // "1.3.0"
 */
export function installedVersion(root: string, name: string): string | null {
  const file = join(root, "node_modules", name, "package.json");
  if (!existsSync(file)) return null;
  try {
    const pkg: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isObject(pkg) && typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * Sets the version of a dependency in package.json, changing nothing else: the file keeps
 * its indentation, line endings and key order. It changes the entry `dependencyVersion`
 * reads (`devDependencies` first, then `dependencies`); a new one goes into
 * `devDependencies`, in alphabetical order, as npm adds it.
 * @param root - The repo.
 * @param name - The package.
 * @param version - The version.
 * @throws KitError if package.json is missing or not a JSON object.
 * @example setDependency(root, "@ramon-sg/skills-manager", "1.2.0")
 */
export function setDependency(root: string, name: string, version: string): void {
  const pkg = readJson(root, "package.json");
  if (pkg === null) throw new KitError(ui.repo.noPackage);
  const [deps, dev] = [pkg.dependencies, pkg.devDependencies];
  if (isObject(dev) && typeof dev[name] === "string") dev[name] = version;
  else if (isObject(deps) && typeof deps[name] === "string") deps[name] = version;
  else {
    const entries = Object.entries(isObject(dev) ? dev : {});
    const at = entries.findIndex(([key]) => key > name);
    entries.splice(at === -1 ? entries.length : at, 0, [name, version]);
    pkg.devDependencies = Object.fromEntries(entries);
  }
  writePackage(root, pkg);
}
