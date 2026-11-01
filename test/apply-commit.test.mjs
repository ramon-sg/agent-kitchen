// Tests of `apply --commit` on real checkouts with a local `origin`: the check before any
// step, the install when package.json changed, and what each answer of the last question
// leaves in git. The question itself needs a terminal (it was run by hand); its answers are
// tested through `finish`, and `--yes` takes the branch with a PR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changedPaths, finish } from "../dist/git-finish.js";
import { GIT_ENV, makeRepo } from "./helpers.mjs";

Object.assign(process.env, GIT_ENV);

/** Only the flow (and what follows it), so each run is short. */
const ONLY_FLOW = ["--skip", "claude-cloud,claude-repo-guard,skills"];

/** The branch a run makes today. */
function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `chore/agent-kitchen-apply-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** What `git status --porcelain` shows, without the worktrees. */
function dirty(repo) {
  return repo.git("status", "--porcelain").split("\n").filter((line) => line !== "" && !line.includes(".claude/worktrees"));
}

/** A repo with a change of its own to commit, for `finish`. */
function changed() {
  const repo = makeRepo({ origin: true });
  repo.write("AGENTS.md", "regla\n");
  return repo;
}

/** Writes a pre-commit hook. */
function hook(repo, script) {
  const file = join(repo.main, ".git", "hooks", "pre-commit");
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
}

test("--commit with a tracked file changed stops before any step", () => {
  const repo = makeRepo({ origin: true });
  repo.write("README.md", "uno\n");
  repo.git("add", "README.md");
  repo.git("commit", "-q", "-m", "readme");
  repo.write("README.md", "dos\n");

  const r = repo.cli(["--yes", "--commit", ...ONLY_FLOW]);

  assert.equal(r.status, 1);
  assert.match(r.err, /cambios/);
  assert.deepEqual(repo.calls(), []);
});

test("--commit with only an untracked file also stops", () => {
  const repo = makeRepo({ origin: true });
  repo.write("notas.txt", "x\n");

  const r = repo.cli(["--yes", "--commit", ...ONLY_FLOW]);

  assert.equal(r.status, 1);
  assert.match(r.err, /notas\.txt/);
  assert.deepEqual(repo.calls(), []);
});

test("--commit ignores the repo's worktrees under .claude/worktrees", () => {
  const repo = makeRepo({ origin: true });
  repo.git("worktree", "add", "-q", ".claude/worktrees/w", "-b", "w");

  const r = repo.cli(["--yes", "--commit", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(repo.git("show", "--name-only", "--format=", today()), /worktrees/);
});

test("--commit off the base branch stops and names both, also with --dry-run", () => {
  const repo = makeRepo({ origin: true });
  repo.git("switch", "-q", "-c", "otra");

  const r = repo.cli(["--yes", "--commit", ...ONLY_FLOW]);
  const d = repo.cli(["--dry-run", "--commit", ...ONLY_FLOW]);

  assert.equal(r.status, 1);
  assert.match(r.err, /otra/);
  assert.match(r.err, /main/);
  assert.deepEqual(repo.calls(), []);
  assert.equal(d.status, 1);
});

test("--commit takes the base from .agents/flow.json", () => {
  const repo = makeRepo({ origin: true });
  repo.write(".agents/flow.json", { baseBranch: "develop" });
  repo.git("add", ".agents/flow.json");
  repo.git("commit", "-q", "-m", "flow");

  const r = repo.cli(["--yes", "--commit", ...ONLY_FLOW]);

  assert.equal(r.status, 1);
  assert.match(r.err, /develop/);
});

test("--commit --yes installs, commits on a new branch, pushes it, opens the PR and goes back to main", () => {
  const repo = makeRepo({ origin: true });
  const before = repo.git("rev-parse", "HEAD");

  const r = repo.cli(["--yes", "--commit", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.npmCalls().filter((args) => args[0] === "install"), [["install"]]);
  assert.equal(repo.git("branch", "--show-current"), "main");
  assert.equal(repo.git("rev-parse", "HEAD"), before);
  assert.deepEqual(dirty(repo), []);
  const branch = today();
  assert.match(repo.git("log", "-1", "--format=%B", branch), /^chore: agent-kitchen apply\n\n- Instalar issue-flow 0\.2\.0/);
  const files = repo.git("show", "--name-only", "--format=", branch).split("\n");
  assert.ok(files.includes("package.json") && files.includes("package-lock.json"), files.join(", "));
  assert.match(repo.git("ls-remote", "--heads", "origin"), new RegExp(`refs/heads/${branch}`));
  const pr = repo.calls().find((args) => args[0].startsWith("@ramon-sg/github-rest@"));
  assert.deepEqual(pr.slice(0, 7), ["@ramon-sg/github-rest@0.2.1", "pr", "create", "--head", branch, "--base", "main"]);
  assert.match(r.out, /https:\/\/github\.com\/o\/r\/pull\/7/);
});

test("the PR runs without GH_REPO, so the repo comes from origin", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--yes", "--commit", ...ONLY_FLOW], { env: { GH_REPO: "otra/cosa" } });

  assert.equal(r.status, 0, r.err);
  const pr = repo.log().find((call) => call.args.some((arg) => arg.startsWith("@ramon-sg/github-rest@")));
  assert.equal(pr.ghRepo, null);
});

test("if the PR fails, the branch stays pushed, the checkout is back on main and the output says what to run", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--yes", "--commit", ...ONLY_FLOW], { env: { FAKE_FAIL: "pr create" } });

  assert.equal(r.status, 1);
  assert.equal(repo.git("branch", "--show-current"), "main");
  assert.match(repo.git("ls-remote", "--heads", "origin"), new RegExp(today()));
  assert.match(`${r.out}${r.err}`, /pr create --head chore\/agent-kitchen-apply-/);
});

test("if the install fails, nothing is committed and the changes stay", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--yes", "--commit", ...ONLY_FLOW], { env: { FAKE_FAIL: "install" } });

  assert.equal(r.status, 1);
  assert.equal(repo.git("rev-list", "--count", "HEAD"), "1");
  assert.equal(repo.git("branch", "--list", "chore/*"), "");
  assert.ok(dirty(repo).some((line) => line.includes("package.json")));
});

test("with a failed step and --yes, nothing is committed", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--yes", "--commit", "--skip", "claude-repo-guard,skills"], { env: { FAKE_FAIL: "claude-cloud" } });

  assert.equal(r.status, 1);
  assert.equal(repo.git("rev-list", "--count", "HEAD"), "1");
  assert.equal(repo.git("branch", "--list", "chore/*"), "");
});

test("with no file changed there is nothing to commit", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--yes", "--commit", "--skip", "claude-cloud,claude-repo-guard,skills,agents-md,skills-manager"], { env: { FAKE_FAIL: "issue-flow" } });

  assert.equal(r.status, 1);
  assert.match(r.out, /nada que commitear/);
  assert.equal(repo.git("branch", "--list", "chore/*"), "");
});

test("without --commit, a dirty repo runs as today and nothing is committed", () => {
  const repo = makeRepo({ origin: true });
  repo.write("notas.txt", "x\n");

  const r = repo.cli(["--yes", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  assert.equal(repo.git("rev-list", "--count", "HEAD"), "1");
  assert.match(r.out, /Falta: corre 'npm install'/);
});

test("finish base: one commit on main, nothing pushed", async () => {
  const repo = changed();

  const result = await finish(repo.main, "base", { base: "main", branch: "chore/x", steps: ["Paso"], paths: ["AGENTS.md"], manager: "npm" });

  assert.equal(result.ok, true, result.lines.join("\n"));
  assert.equal(repo.git("log", "-1", "--format=%s"), "chore: agent-kitchen apply");
  assert.deepEqual(dirty(repo), []);
  assert.doesNotMatch(repo.git("ls-remote", "--heads", "origin"), /chore/);
});

test("finish branch: the commit lives on a local branch and main is untouched", async () => {
  const repo = changed();
  const before = repo.git("rev-parse", "HEAD");

  const result = await finish(repo.main, "branch", { base: "main", branch: "chore/x", steps: ["Paso"], paths: ["AGENTS.md"], manager: "npm" });

  assert.equal(result.ok, true, result.lines.join("\n"));
  assert.equal(repo.git("branch", "--show-current"), "main");
  assert.equal(repo.git("rev-parse", "HEAD"), before);
  assert.deepEqual(dirty(repo), []);
  assert.equal(repo.git("log", "-1", "--format=%s", "chore/x"), "chore: agent-kitchen apply");
  assert.doesNotMatch(repo.git("ls-remote", "--heads", "origin"), /chore/);
});

test("a hook that forbids commits on main lets the branch through and stops a commit on main", async () => {
  const onBranch = changed();
  const onBase = changed();
  const noMain = '[ "$(git branch --show-current)" = main ] && exit 1 || exit 0';
  hook(onBranch, noMain);
  hook(onBase, noMain);

  const branch = await finish(onBranch.main, "branch", { base: "main", branch: "chore/x", steps: ["Paso"], paths: ["AGENTS.md"], manager: "npm" });
  const base = await finish(onBase.main, "base", { base: "main", branch: "chore/x", steps: ["Paso"], paths: ["AGENTS.md"], manager: "npm" });

  assert.equal(branch.ok, true, branch.lines.join("\n"));
  assert.equal(base.ok, false);
  assert.equal(onBase.git("rev-list", "--count", "HEAD"), "1");
  assert.ok(dirty(onBase).some((line) => line.includes("AGENTS.md")));
});

test("a hook that always fails leaves the changes on main and no branch", async () => {
  const repo = changed();
  hook(repo, "exit 1");

  const result = await finish(repo.main, "branch", { base: "main", branch: "chore/x", steps: ["Paso"], paths: ["AGENTS.md"], manager: "npm" });

  assert.equal(result.ok, false);
  assert.equal(repo.git("branch", "--show-current"), "main");
  assert.equal(repo.git("branch", "--list", "chore/x"), "");
  assert.ok(dirty(repo).some((line) => line.includes("AGENTS.md")));
});

test("a branch of today that exists locally or on origin gets -2", () => {
  const local = makeRepo({ origin: true });
  const remote = makeRepo({ origin: true });
  local.git("branch", today());
  remote.git("push", "-q", "origin", `HEAD:refs/heads/${today()}`);
  remote.git("fetch", "-q", "origin");

  const a = local.cli(["--yes", "--commit", ...ONLY_FLOW]);
  const b = remote.cli(["--yes", "--commit", ...ONLY_FLOW]);

  assert.equal(a.status, 0, a.err);
  assert.equal(b.status, 0, b.err);
  assert.match(local.git("log", "-1", "--format=%s", `${today()}-2`), /agent-kitchen apply/);
  assert.match(remote.git("log", "-1", "--format=%s", `${today()}-2`), /agent-kitchen apply/);
});

test("doctor takes no --commit", () => {
  const repo = makeRepo();

  const r = repo.cli(["doctor", "--commit"]);

  assert.equal(r.status, 2);
});

test("finish commits only the files it is given, taken literally", async () => {
  const repo = changed();
  repo.write("g[1].txt", "a\n");
  repo.write("g1.txt", "b\n");

  const result = await finish(repo.main, "base", { base: "main", branch: "chore/x", steps: ["Paso"], paths: ["g[1].txt"], manager: "npm" });

  assert.equal(result.ok, true, result.lines.join("\n"));
  assert.deepEqual(repo.git("show", "--name-only", "--format=", "HEAD").split("\n"), ["g[1].txt"]);
});

test("changedPaths reads paths with spaces and renames", () => {
  const repo = makeRepo();
  repo.write("a b.txt", "x\n");
  repo.write("viejo.txt", "y\n");
  repo.git("add", "viejo.txt");
  repo.git("commit", "-q", "-m", "viejo");
  repo.git("mv", "viejo.txt", "nuevo.txt");

  assert.deepEqual(changedPaths(repo.main).sort(), ["a b.txt", "nuevo.txt"]);
});

test("if the push fails, the checkout is back on main and the branch stays local", async () => {
  const repo = makeRepo();
  repo.write("AGENTS.md", "regla\n");

  const result = await finish(repo.main, "pr", { base: "main", branch: "chore/x", steps: ["Paso"], paths: ["AGENTS.md"], manager: "npm" });

  assert.equal(result.ok, false);
  assert.equal(repo.git("branch", "--show-current"), "main");
  assert.equal(repo.git("log", "-1", "--format=%s", "chore/x"), "chore: agent-kitchen apply");
  assert.match(result.lines.join("\n"), /git push -u origin chore\/x/);
});

test("--commit --dry-run on a clean repo on main exits 0 and writes nothing", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--dry-run", "--commit", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls(), []);
  assert.deepEqual(dirty(repo), []);
});

test("finish commits the decisions file alone, saying so in the body (issue #27)", async () => {
  const { commitLabels } = await import("../dist/commands/sync.js");
  const repo = makeRepo({ origin: true });
  repo.write(".agents/kitchen.json", { pieces: { "claude-repo-guard": false } });

  const result = await finish(repo.main, "base", { base: "main", branch: "chore/x", steps: commitLabels([], true), paths: changedPaths(repo.main), manager: "npm" });

  assert.equal(result.ok, true, result.lines.join("\n"));
  assert.equal(repo.git("log", "-1", "--format=%b").trim(), "- Guardar qué piezas usa el repo en .agents/kitchen.json");
  assert.match(repo.git("show", "--name-only", "--format=", "HEAD"), /^\.agents\/kitchen\.json$/m);
  assert.deepEqual(dirty(repo), []);
});
