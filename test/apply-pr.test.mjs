// Tests of `apply --pr` and `apply --here` on real checkouts with a local `origin`: --pr works
// in a clone of origin/<base> and leaves the checkout as it was (branch, commit, files, no new
// branch), commits with the repo's hooks, pushes a new branch from the repo and opens the PR
// in draft; it keeps the clone when something fails before the push. --here works in the
// checkout and warns about what it already has. The question of where to work needs a
// terminal (it was run by hand).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changedPaths, publish } from "../dist/pr-clone.js";
import { GIT_ENV, makeRepo } from "./helpers.mjs";

Object.assign(process.env, GIT_ENV);

/** Only the flow (and what follows it), so each run is short. */
const ONLY_FLOW = ["--skip", "agent-cloud-kit,claude-repo-guard,skills"];

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

/** The folder of the clone: where the last run's npx calls ran. */
function cloneOf(repo) {
  const call = repo.log().find((each) => each.cwd !== repo.main);
  assert.ok(call !== undefined, "no call ran outside the checkout");
  return call.cwd;
}

/** Checks the clone was kept, and deletes it. */
function keptClone(repo) {
  const clone = cloneOf(repo);
  assert.ok(existsSync(clone), "the clone is kept");
  rmSync(clone, { recursive: true, force: true });
  return clone;
}

/** Writes a hook in a folder. */
function hook(dir, name, script) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
}

/** Origin's branches. */
function remoteHeads(repo) {
  return repo.git("ls-remote", "--heads", "origin");
}

/** Pushes a commit to origin's main from another clone, so the checkout falls behind. */
function advanceOrigin(repo, file = "OTRO.md") {
  const other = join(repo.tmp, "other");
  execFileSync("git", ["clone", "-q", join(repo.tmp, "origin.git"), other]);
  writeFileSync(join(other, file), "de otra persona\n");
  execFileSync("git", ["add", file], { cwd: other });
  execFileSync("git", ["commit", "-q", "-m", "otro"], { cwd: other });
  execFileSync("git", ["push", "-q", "origin", "main"], { cwd: other });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: other, encoding: "utf8" }).trim();
}

test("--pr --yes works in a clone, pushes a new branch, opens the PR in draft and leaves the checkout as it was", () => {
  const repo = makeRepo({ origin: true });
  const before = repo.git("rev-parse", "HEAD");

  const r = repo.cli(["--yes", "--pr", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  const clone = cloneOf(repo);
  assert.notEqual(clone, repo.main);
  assert.equal(existsSync(clone), false, "the clone is deleted");
  assert.equal(repo.git("branch", "--show-current"), "main");
  assert.equal(repo.git("rev-parse", "HEAD"), before);
  assert.deepEqual(dirty(repo), []);
  assert.equal(repo.git("branch", "--list"), "* main");
  assert.equal(repo.exists("package.json"), false);
  const branch = `origin/${today()}`;
  assert.match(remoteHeads(repo), new RegExp(`refs/heads/${today()}`));
  assert.match(repo.git("log", "-1", "--format=%B", branch), /^chore: agent-kitchen apply\n\n- Instalar issue-flow 0\.2\.0/);
  const files = repo.git("show", "--name-only", "--format=", branch).split("\n");
  assert.ok(files.includes("package.json") && files.includes("package-lock.json"), files.join(", "));
  assert.deepEqual(repo.npmCalls().filter((args) => args[0] === "install"), [["install"]]);
  const pr = repo.calls().find((args) => args[0].startsWith("@ramon-sg/github-rest@"));
  assert.deepEqual(pr.slice(0, 7), ["@ramon-sg/github-rest@0.2.1", "pr", "create", "--head", today(), "--base", "main"]);
  assert.ok(pr.includes("--draft"), pr.join(" "));
  assert.match(r.out, /\[ok\] PR en draft abierto\.\n\n  PR  https:\/\/github\.com\/o\/r\/pull\/7\n/);
  assert.match(r.out, /copia temporal de origin\/main/);
});

test("--pr starts from origin's base, not from a checkout behind it", () => {
  const repo = makeRepo({ origin: true });
  const before = repo.git("rev-parse", "HEAD");
  const ahead = advanceOrigin(repo);

  const r = repo.cli(["--yes", "--pr", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  assert.equal(repo.git("rev-parse", `origin/${today()}^`), ahead);
  assert.equal(repo.git("rev-parse", "HEAD"), before);
});

test("--pr leaves the checkout's own changes alone and out of the PR", () => {
  const repo = makeRepo({ origin: true });
  repo.write("notas.txt", "x\n");

  const r = repo.cli(["--yes", "--pr", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(dirty(repo), ["?? notas.txt"]);
  assert.doesNotMatch(repo.git("show", "--name-only", "--format=", `origin/${today()}`), /notas/);
});

test("the PR runs from the checkout without GH_REPO, so the repo comes from origin", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--yes", "--pr", ...ONLY_FLOW], { env: { GH_REPO: "otra/cosa" } });

  assert.equal(r.status, 0, r.err);
  const pr = repo.log().find((call) => call.args.some((arg) => arg.startsWith("@ramon-sg/github-rest@")));
  assert.equal(pr.ghRepo, null);
  assert.equal(pr.cwd, repo.main);
});

test("if the PR fails, the branch stays on origin, no local branch is made and the output says what to run", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--yes", "--pr", ...ONLY_FLOW], { env: { FAKE_FAIL: "pr create" } });

  assert.equal(r.status, 1);
  assert.equal(repo.git("branch", "--list"), "* main");
  assert.match(remoteHeads(repo), new RegExp(today()));
  assert.match(r.out, /pr create --head chore\/agent-kitchen-apply-.* --draft/);
  assert.equal(existsSync(cloneOf(repo)), false);
});

test("if the install fails, nothing is pushed and the clone is kept with its path in the output", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--yes", "--pr", ...ONLY_FLOW], { env: { FAKE_FAIL: "install" } });

  assert.equal(r.status, 1);
  assert.match(r.out, /^✗ Falló: Instalar las dependencias con npm \(\d+,\d s\)$/m);
  assert.doesNotMatch(remoteHeads(repo), /chore/);
  assert.ok(existsSync(join(cloneOf(repo), "package.json")));
  assert.ok(r.out.includes(`copia temporal ${keptClone(repo)}`), r.out);
});

test("with a failed step, nothing is pushed and the clone is kept", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--yes", "--pr", "--skip", "claude-repo-guard,skills"], { env: { FAKE_FAIL: "agent-cloud-kit" } });

  assert.equal(r.status, 1);
  assert.doesNotMatch(remoteHeads(repo), /chore/);
  assert.match(r.out, /No abrí el PR porque algún paso falló/);
  keptClone(repo);
});

test("with no file changed there is no PR", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--yes", "--pr", "--skip", "agent-cloud-kit,claude-repo-guard,skills,agents-md,skills-manager"], { env: { FAKE_FAIL: "issue-flow" } });

  assert.equal(r.status, 1);
  assert.match(r.out, /no hay PR que abrir/);
  assert.doesNotMatch(remoteHeads(repo), /chore/);
});

test("the commit runs the hooks of .git/hooks, and one that fails stops the push and keeps the clone", () => {
  const passes = makeRepo({ origin: true });
  const fails = makeRepo({ origin: true });
  hook(join(passes.main, ".git", "hooks"), "pre-commit", `touch "${join(passes.tmp, "ran")}"`);
  hook(join(fails.main, ".git", "hooks"), "pre-commit", "exit 1");

  const ok = passes.cli(["--yes", "--pr", ...ONLY_FLOW]);
  const ko = fails.cli(["--yes", "--pr", ...ONLY_FLOW]);

  assert.equal(ok.status, 0, ok.err);
  assert.ok(existsSync(join(passes.tmp, "ran")), "the hook ran");
  assert.equal(ko.status, 1);
  assert.match(ko.out, /No pude hacer el commit/);
  assert.doesNotMatch(remoteHeads(fails), /chore/);
  keptClone(fails);
});

test("a relative core.hooksPath runs the hooks committed on origin's base", () => {
  const repo = makeRepo({ origin: true });
  hook(join(repo.main, ".githooks"), "commit-msg", `grep -q "^chore: " "$1" && touch "${join(repo.tmp, "msg")}"`);
  repo.git("add", ".githooks");
  repo.git("commit", "-q", "-m", "hooks");
  repo.git("push", "-q", "origin", "main");
  repo.git("config", "core.hooksPath", ".githooks");

  const r = repo.cli(["--yes", "--pr", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  assert.ok(existsSync(join(repo.tmp, "msg")), "the committed hook ran");
});

test("a branch of today that exists on origin gets -2", () => {
  const repo = makeRepo({ origin: true });
  repo.git("push", "-q", "origin", `HEAD:refs/heads/${today()}`);

  const r = repo.cli(["--yes", "--pr", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  assert.match(repo.git("log", "-1", "--format=%s", `origin/${today()}-2`), /agent-kitchen apply/);
});

test("--pr without origin stops before any step", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", "--pr", ...ONLY_FLOW]);

  assert.equal(r.status, 1);
  assert.match(r.err, /origin/);
  assert.deepEqual(repo.calls(), []);
});

test("--pr --dry-run lists the steps from origin's base and pushes nothing", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--dry-run", "--pr", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /\[x\] Instalar issue-flow/);
  assert.deepEqual(repo.calls(), []);
  assert.doesNotMatch(remoteHeads(repo), /chore/);
});

test("--commit is gone and points to --pr; --pr and --here together are a usage error", () => {
  const repo = makeRepo({ origin: true });

  const commit = repo.cli(["--yes", "--commit"]);
  const both = repo.cli(["--yes", "--pr", "--here"]);
  const doctor = repo.cli(["doctor", "--pr"]);

  assert.equal(commit.status, 2);
  assert.match(commit.err, /--commit ya no existe: usa --pr/);
  assert.equal(both.status, 2);
  assert.equal(doctor.status, 2);
});

test("--here with changes and behind origin warns, runs and commits nothing", () => {
  const repo = makeRepo({ origin: true });
  repo.git("branch", "-q", "--set-upstream-to", "origin/main");
  advanceOrigin(repo);
  repo.git("fetch", "-q", "origin");
  repo.write("notas.txt", "x\n");

  const r = repo.cli(["--yes", "--here", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.err, /cambios sin commit \(notas\.txt\)/);
  assert.match(r.err, /1 commit atrás de origin/);
  assert.equal(repo.git("rev-list", "--count", "HEAD"), "1");
  assert.ok(repo.exists("package.json"));
  assert.match(r.out, /Falta: revisa el diff y haz commit\./);
});

test("without --pr nor --here, --yes works in the checkout", () => {
  const repo = makeRepo({ origin: true });

  const r = repo.cli(["--yes", ...ONLY_FLOW]);

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.exists("package.json"));
  assert.doesNotMatch(remoteHeads(repo), /chore/);
  assert.equal(repo.log().every((call) => call.cwd === repo.main), true);
});

test("publish commits only the files it is given, taken literally", async () => {
  const repo = makeRepo({ origin: true });
  repo.write("g[1].txt", "a\n");
  repo.write("g1.txt", "b\n");
  const clone = join(repo.tmp, "clone");
  execFileSync("git", ["clone", "-q", repo.main, clone]);
  execFileSync("git", ["remote", "set-url", "origin", join(repo.tmp, "origin.git")], { cwd: clone });
  writeFileSync(join(clone, "g[1].txt"), "a\n");
  writeFileSync(join(clone, "g1.txt"), "b\n");

  const result = await publish(repo.main, clone, { base: "main", steps: ["Paso"], paths: ["g[1].txt"] });

  assert.equal(result.pushed, true, [result.problem, ...result.details].join("\n"));
  assert.deepEqual(repo.git("show", "--name-only", "--format=", `origin/${today()}`).split("\n"), ["g[1].txt"]);
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
