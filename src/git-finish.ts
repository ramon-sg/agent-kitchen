/**
 * @file What `apply --commit` does with git: before any step, it checks that the repo has no
 * changes (the repo's worktrees under it do not count) and is on its base branch; after the
 * steps, it commits what changed where the person chose. A new branch is made by passing
 * through it for the length of the command: `git switch -c`, the commit there (so a hook that
 * forbids commits on the base does not stop it), the push and the PR if asked, and back to
 * the base, which never moves. git runs its hooks; nothing here skips them.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { COMMIT_TITLE as TITLE, prBody } from "./commit-texts.js";
import { KitError } from "./output.js";
import { FLOW_CONFIG } from "./piece.js";
import { dependencyVersion, readJson } from "./repo.js";
import { captureNpxWithout, isRelease, npmLatest } from "./tools.js";

/** What to do with the changes: leave them, commit on the base, on a branch, or a branch with a PR. */
export type FinishChoice = "leave" | "base" | "branch" | "pr";

/** github-rest on npm, which opens the PR (REST, never gh's GraphQL). */
const GITHUB_REST = "@ramon-sg/github-rest";

/** What git printed and whether it worked. */
interface GitRun {
  ok: boolean;
  out: string;
  err: string;
}

/**
 * Runs git in the repo.
 * @param root - The repo.
 * @param args - The arguments.
 * @param inherit - True to show its output on the terminal, for a push that may ask for credentials.
 * @returns How it went.
 */
function git(root: string, args: string[], inherit = false): GitRun {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: inherit ? "inherit" : "pipe" });
  return { ok: result.status === 0, out: (result.stdout ?? "").trimEnd(), err: (result.stderr ?? "").trim() };
}

/**
 * The base branch, as issue-flow takes it: `baseBranch` of `.agents/flow.json`, or origin's
 * default as git knows it, or `main`.
 * @param root - The repo.
 * @returns The branch.
 * @example baseBranch(root) // "main"
 */
export function baseBranch(root: string): string {
  const flow = readJson(root, FLOW_CONFIG);
  if (typeof flow?.baseBranch === "string" && flow.baseBranch !== "") return flow.baseBranch;
  const head = git(root, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  return head.ok && head.out.startsWith("origin/") ? head.out.slice("origin/".length) : "main";
}

/**
 * The repo's other worktrees that live inside it, relative to it.
 * @param root - The repo.
 * @returns Their folders, like `.claude/worktrees/feat+1-x`.
 */
function innerWorktrees(root: string): string[] {
  const list = git(root, ["worktree", "list", "--porcelain"]);
  if (!list.ok) return [];
  return list.out
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => relative(root, line.slice("worktree ".length)))
    .filter((path) => path !== "" && !path.startsWith(".."));
}

/**
 * The files that differ from HEAD, tracked or not, one by one, without the repo's worktrees.
 * @param root - The repo.
 * @returns Their paths.
 * @example changedPaths(root) // ["package.json", "package-lock.json"]
 */
export function changedPaths(root: string): string[] {
  const status = git(root, ["status", "--porcelain", "-uall", "-z"]);
  if (!status.ok) throw new KitError(`no pude leer git status: ${status.err}`);
  const worktrees = innerWorktrees(root);
  const entries = status.out.split("\0").filter((entry) => entry !== "");
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    if (/[RC]/.test(entry.slice(0, 2))) index += 1;
    const path = entry.slice(3).replace(/\/$/, "");
    if (!worktrees.some((tree) => path === tree || path.startsWith(`${tree}/`))) paths.push(path);
  }
  return paths;
}

/**
 * Checks, before any step, that the repo has no changes and is on its base branch.
 * @param root - The repo.
 * @param base - The base branch.
 * @throws KitError saying what is wrong and what to do.
 */
export function checkReady(root: string, base: string): void {
  const branch = git(root, ["branch", "--show-current"]).out;
  if (branch === "") throw new KitError(`--commit necesita estar en ${base}, y HEAD no está en ninguna rama.`);
  if (branch !== base) throw new KitError(`--commit necesita estar en ${base}, la rama base, y estás en ${branch}.`);
  const paths = changedPaths(root);
  if (paths.length > 0) throw new KitError(`--commit necesita el repo sin cambios, y hay cambios en: ${paths.join(", ")}. Commitéalos o guárdalos aparte y corre otra vez.`);
}

/**
 * The branch for today's changes: a new name, also against origin's branches git knows of.
 * @param root - The repo.
 * @param date - Today.
 * @returns `chore/agent-kitchen-apply-AAAA-MM-DD`, or with `-2`, `-3`… if taken.
 * @example branchName(root, new Date()) // "chore/agent-kitchen-apply-2026-11-01"
 */
export function branchName(root: string, date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const name = `chore/agent-kitchen-apply-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const taken = (candidate: string): boolean => git(root, ["rev-parse", "-q", "--verify", `refs/heads/${candidate}`]).ok || git(root, ["rev-parse", "-q", "--verify", `refs/remotes/origin/${candidate}`]).ok;
  if (!taken(name)) return name;
  let n = 2;
  while (taken(`${name}-${n}`)) n += 1;
  return `${name}-${n}`;
}

/**
 * Stages the files shown to the person, taken literally, and commits them, with the hooks.
 * @param root - The repo.
 * @param paths - The files.
 * @param steps - The steps that ran, for the body.
 * @returns How git went.
 */
function commit(root: string, paths: string[], steps: string[]): GitRun {
  const add = git(root, ["--literal-pathspecs", "add", "-A", "--", ...paths]);
  if (!add.ok) return add;
  return git(root, ["commit", "-q", "-m", TITLE, "-m", steps.map((step) => `- ${step}`).join("\n")]);
}

/**
 * The version of github-rest to open the PR with: the repo's exact one, or npm's latest.
 * @param root - The repo.
 * @returns The version, or null if neither is known.
 */
async function githubRestVersion(root: string): Promise<string | null> {
  const own = dependencyVersion(readJson(root, "package.json"), GITHUB_REST);
  if (own !== null && isRelease(own)) return own;
  return npmLatest(GITHUB_REST);
}

/**
 * Opens the PR with github-rest, without GH_REPO, so the repo is origin's.
 * @param root - The repo, on the branch.
 * @param branch - The branch.
 * @param base - The base.
 * @param steps - The steps, for the body.
 * @returns The PR's URL, or why it failed.
 */
async function openPr(root: string, branch: string, base: string, steps: string[]): Promise<{ url: string } | { error: string }> {
  const version = await githubRestVersion(root);
  if (version === null) return { error: `no sé qué versión de ${GITHUB_REST} usar.` };
  const dir = mkdtempSync(join(tmpdir(), "agent-kitchen-pr-"));
  const bodyFile = join(dir, "body.md");
  writeFileSync(bodyFile, prBody(steps));
  try {
    const result = await captureNpxWithout(root, [`${GITHUB_REST}@${version}`, "pr", "create", "--head", branch, "--base", base, "--title", TITLE, "--body-file", bodyFile], ["GH_REPO"]);
    const url = result.out.trim().split("\n").at(-1) ?? "";
    return result.status === 0 && url !== "" ? { url } : { error: `${result.err}${result.out}`.trim() || "github-rest falló sin decir por qué." };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * What the person can run to open the PR by hand.
 * @param branch - The branch.
 * @param base - The base.
 * @returns The command.
 */
function prCommand(branch: string, base: string): string {
  return `npx @ramon-sg/github-rest pr create --head ${branch} --base ${base} --title "${TITLE}" --body "..."`;
}

/**
 * Pushes the branch and opens its PR, saying what to run if either fails.
 * @param root - The repo, on the branch.
 * @param branch - The branch.
 * @param base - The base.
 * @param steps - The steps, for the body.
 * @param lines - Where to add what happened.
 * @returns Whether both worked.
 */
async function pushAndOpen(root: string, branch: string, base: string, steps: string[], lines: string[]): Promise<boolean> {
  const pushed = git(root, ["push", "-u", "origin", branch], true);
  if (!pushed.ok) {
    lines.push(`No pude subir la rama. Falta: git push -u origin ${branch}, y luego ${prCommand(branch, base)}`);
    return false;
  }
  const pr = await openPr(root, branch, base, steps);
  if ("url" in pr) {
    lines.push(`PR: ${pr.url}`);
    return true;
  }
  lines.push(`La rama está en origin, pero no pude abrir el PR: ${pr.error}`, `Falta: ${prCommand(branch, base)}`);
  return false;
}

/** What `finish` needs to know. */
export interface FinishOptions {
  base: string;
  branch: string;
  steps: string[];
  paths: string[];
  manager: string;
  packageChanged?: boolean;
}

/**
 * Does what the person chose with the changes.
 * @param root - The repo, on the base, with the changes of the run.
 * @param choice - What to do.
 * @param options - The base, the new branch's name, the steps that ran, the files to commit (the ones shown), the package manager and whether package.json changed.
 * @returns The lines to show and whether it all worked.
 * @example await finish(root, "pr", { base: "main", branch: "chore/agent-kitchen-apply-2026-11-01", steps, manager: "npm" })
 */
export async function finish(root: string, choice: FinishChoice, options: FinishOptions): Promise<{ ok: boolean; lines: string[] }> {
  const { base, branch, steps, paths } = options;
  if (choice === "leave") return { ok: true, lines: ["Falta: revisa el diff y haz commit."] };
  if (choice === "base") {
    const done = commit(root, paths, steps);
    if (!done.ok) return { ok: false, lines: [`No pude commitear en ${base}; los cambios quedan sin commit.`, done.err || done.out] };
    return { ok: true, lines: [`Commit en ${base}. Falta: git push cuando quieras.`] };
  }
  const moved = git(root, ["switch", "-q", "-c", branch]);
  if (!moved.ok) return { ok: false, lines: [`No pude crear la rama ${branch}; los cambios quedan sin commit.`, moved.err] };
  const lines: string[] = [];
  let ok = true;
  let committed = false;
  try {
    const done = commit(root, paths, steps);
    if (!done.ok) {
      ok = false;
      lines.push("No pude commitear.", done.err || done.out);
    } else {
      committed = true;
      lines.push(`Commit en la rama ${branch}.`);
      if (choice === "pr") ok = await pushAndOpen(root, branch, base, steps, lines);
    }
  } finally {
    const back = git(root, ["switch", "-q", base]);
    if (!back.ok) {
      ok = false;
      lines.push(`No pude volver a ${base}: ${back.err}. Sigues en ${branch}.`);
    } else if (!committed) {
      git(root, ["branch", "-q", "-d", branch]);
      lines.push(`Vuelves a ${base} con los cambios sin commit.`);
    } else lines.push(`Vuelves a ${base}, sin los cambios: están en ${branch}.`);
  }
  if (!committed) return { ok: false, lines };
  if (options.packageChanged === true) lines.push(`node_modules quedó con lo de la rama; si sigues en ${base}, corre '${options.manager} install'.`);
  return { ok, lines };
}
