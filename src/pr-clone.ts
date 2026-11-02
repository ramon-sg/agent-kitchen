/**
 * @file What `apply --pr` does with git. It fetches origin and clones the repo into a temporary
 * folder at `origin/<base>`, so the steps see what the base has today and the person's checkout
 * is never touched: not its branch, its files, nor its node_modules. A clone and not a worktree,
 * because `issue-flow apply` refuses to run in a worktree. The clone shares the repo's objects
 * (`--shared`), points its origin where the repo's does, and commits with the repo's hooks,
 * identity and signing. The commit goes from the clone into the repo's objects and the repo
 * pushes it straight to a new branch of origin, with its own credentials, so no local branch
 * is made. Then github-rest opens the PR in draft. git runs its hooks; nothing here skips them.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { COMMIT_TITLE as TITLE, prBody } from "./commit-texts.js";
import { KitError } from "./output.js";
import { FLOW_CONFIG } from "./piece.js";
import { dependencyVersion, readJson } from "./repo.js";
import { captureNpxWithout, isRelease, npmLatest } from "./tools.js";

/** github-rest on npm, which opens the PR (REST, never gh's GraphQL). */
const GITHUB_REST = "@ramon-sg/github-rest";

/** The settings of the repo a commit made in the clone needs: who signs it and how. */
const IDENTITY = ["user.name", "user.email", "user.signingkey", "commit.gpgsign", "gpg.format", "gpg.program", "gpg.openpgp.program", "gpg.x509.program", "gpg.ssh.program", "gpg.ssh.allowedsignersfile"];

/** What git printed and whether it worked. */
interface GitRun {
  ok: boolean;
  out: string;
  err: string;
}

/**
 * Runs git in a folder.
 * @param cwd - The folder.
 * @param args - The arguments.
 * @returns How it went.
 */
function git(cwd: string, args: string[]): GitRun {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
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
 * Origin's URL.
 * @param root - The repo.
 * @returns The URL, or null if the repo has no origin.
 */
export function originUrl(root: string): string | null {
  const url = git(root, ["remote", "get-url", "origin"]);
  return url.ok && url.out !== "" ? url.out : null;
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
 * How many commits the current branch is behind its upstream, as the last fetch saw it.
 * @param root - The repo.
 * @returns The count, or 0 without an upstream.
 */
export function behindUpstream(root: string): number {
  const count = git(root, ["rev-list", "--count", "HEAD..@{upstream}"]);
  return count.ok ? Number(count.out) || 0 : 0;
}

/**
 * The branch for today's changes: a new name, also against origin's branches.
 * @param root - The repo, just fetched.
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
 * The hooks the clone runs: the repo's `core.hooksPath` as is when it is relative and the
 * folder is in the clone (committed, like `.githooks`), or else the folder the repo uses,
 * absolute (`.git/hooks`, or a generated one like husky's).
 * @param root - The repo.
 * @param clone - The clone.
 * @returns The folder.
 */
function hooksPath(root: string, clone: string): string {
  const own = git(root, ["config", "--get", "core.hooksPath"]);
  if (own.ok && own.out !== "" && !isAbsolute(own.out) && existsSync(join(clone, own.out))) return own.out;
  return git(root, ["rev-parse", "--path-format=absolute", "--git-path", "hooks"]).out;
}

/**
 * Fetches origin and clones the repo at `origin/<base>` into a temporary folder.
 * @param root - The repo.
 * @param base - The base branch.
 * @returns The clone's folder.
 * @throws KitError if the repo has no origin, the fetch fails or origin has no such branch.
 */
export function cloneFromOrigin(root: string, base: string): string {
  const url = originUrl(root);
  if (url === null) throw new KitError("--pr necesita un remoto origin, y este repo no tiene.");
  const fetched = git(root, ["fetch", "-q", "--prune", "origin"]);
  if (!fetched.ok) throw new KitError(`no pude bajar origin con git fetch; revisa la conexión o las credenciales y corre otra vez.${fetched.err === "" ? "" : `\n${fetched.err}`}`);
  const head = git(root, ["rev-parse", "-q", "--verify", `refs/remotes/origin/${base}^{commit}`]);
  if (!head.ok) throw new KitError(`origin no tiene la rama ${base}.`);
  const clone = realpathSync(mkdtempSync(join(tmpdir(), "agent-kitchen-pr-")));
  const steps: string[][] = [
    ["clone", "-q", "--shared", "--no-checkout", root, clone],
    ["-C", clone, "remote", "set-url", "origin", url],
    ["-C", clone, "update-ref", `refs/remotes/origin/${base}`, head.out],
    ["-C", clone, "symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${base}`],
    ["-C", clone, "checkout", "-q", "--detach", head.out],
  ];
  for (const args of steps) {
    const done = git(root, args);
    if (!done.ok) {
      rmSync(clone, { recursive: true, force: true });
      throw new KitError(`no pude preparar la copia temporal: ${done.err}`);
    }
  }
  for (const key of IDENTITY) {
    const value = git(root, ["config", "--get", key]);
    if (value.ok && value.out !== "") git(clone, ["config", key, value.out]);
  }
  git(clone, ["config", "core.hooksPath", hooksPath(root, clone)]);
  return clone;
}

/**
 * Deletes the clone.
 * @param clone - Its folder.
 */
export function removeClone(clone: string): void {
  rmSync(clone, { recursive: true, force: true });
}

/**
 * The version of github-rest to open the PR with: the repo's exact one, or npm's latest.
 * @param root - The checkout to read package.json from.
 * @returns The version, or null if neither is known.
 */
async function githubRestVersion(root: string): Promise<string | null> {
  const own = dependencyVersion(readJson(root, "package.json"), GITHUB_REST);
  if (own !== null && isRelease(own)) return own;
  return npmLatest(GITHUB_REST);
}

/**
 * Opens the PR in draft with github-rest, without GH_REPO, so the repo is origin's.
 * @param root - The repo.
 * @param clone - The clone, whose package.json says which github-rest the base uses.
 * @param branch - The branch.
 * @param base - The base.
 * @param steps - The steps, for the body.
 * @returns The PR's URL, or why it failed.
 */
async function openPr(root: string, clone: string, branch: string, base: string, steps: string[]): Promise<{ url: string } | { error: string }> {
  const version = await githubRestVersion(clone);
  if (version === null) return { error: `no sé qué versión de ${GITHUB_REST} usar.` };
  const dir = mkdtempSync(join(tmpdir(), "agent-kitchen-body-"));
  const bodyFile = join(dir, "body.md");
  writeFileSync(bodyFile, prBody(steps));
  try {
    const result = await captureNpxWithout(root, [`${GITHUB_REST}@${version}`, "pr", "create", "--head", branch, "--base", base, "--title", TITLE, "--body-file", bodyFile, "--draft"], ["GH_REPO"]);
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
  return `npx @ramon-sg/github-rest pr create --head ${branch} --base ${base} --title "${TITLE}" --body "..." --draft`;
}

/** What `publish` needs to know. */
export interface PublishOptions {
  base: string;
  steps: string[];
  paths: string[];
}

/**
 * Commits the clone's changes, pushes them from the repo to a new branch of origin and opens
 * the PR. Until the push works, the commit lives only in the clone, which the caller keeps.
 * @param root - The repo.
 * @param clone - The clone, with the changes.
 * @param options - The base, the steps that ran (for the commit and the PR) and the files to commit (the ones shown).
 * @returns The lines to show, whether it all worked and whether the changes reached origin.
 * @example await publish(root, clone, { base: "main", steps, paths })
 */
export async function publish(root: string, clone: string, options: PublishOptions): Promise<{ ok: boolean; pushed: boolean; lines: string[] }> {
  const { base, steps, paths } = options;
  const add = git(clone, ["--literal-pathspecs", "add", "-A", "--", ...paths]);
  const done = add.ok ? git(clone, ["commit", "-q", "-m", TITLE, "-m", steps.map((step) => `- ${step}`).join("\n")]) : add;
  if (!done.ok) return { ok: false, pushed: false, lines: ["No pude hacer el commit.", done.err || done.out].filter((line) => line !== "") };
  const sha = git(clone, ["rev-parse", "HEAD"]).out;
  const branch = branchName(root, new Date());
  // git asks for credentials on the terminal itself, so its output can stay captured.
  const fetched = git(root, ["fetch", "-q", clone, "HEAD"]);
  const pushed = fetched.ok ? git(root, ["push", "-q", "origin", `${sha}:refs/heads/${branch}`]) : fetched;
  if (!pushed.ok) return { ok: false, pushed: false, lines: [`No pude subir la rama ${branch} a origin.`, pushed.err].filter((line) => line !== "") };
  const pr = await openPr(root, clone, branch, base, steps);
  if ("url" in pr) return { ok: true, pushed: true, lines: [`PR en draft: ${pr.url}`] };
  return { ok: false, pushed: true, lines: [`La rama ${branch} está en origin, pero no pude abrir el PR: ${pr.error}`, `Falta: ${prCommand(branch, base)}`] };
}
