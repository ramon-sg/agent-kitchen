// Tests of `agent-kitchen doctor`: it asks each tool's own doctor at the repo's version, adds
// what joins the pieces (the flow's skills at its tag, the guard's option on macOS), and
// only notes what is missing or behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { installedRepo, makeRepo } from "./helpers.mjs";

test("doctor passes on a repo with every piece, asking each tool at the repo's version", () => {
  const repo = installedRepo();

  const r = repo.cli(["doctor"]);

  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /✗/);
  assert.match(r.out, /✓ issue-flow: skills: 2 en v0\.2\.0/);
  assert.deepEqual(repo.calls().map((args) => args.join(" ")).sort(), [
    "@ramon-sg/issue-flow@0.2.0 doctor --json",
    "@ramon-sg/skills-manager@1.2.0 check",
    "github:ramon-sg/claude-repo-guard#v0.2.0 doctor --json",
  ]);
});

test("doctor names each problem, and only notes a newer release", () => {
  const repo = installedRepo({ cloud: "0.9.0" });
  const lock = repo.read(".agents/skills.lock.json");
  lock.skills["close-pr"].tag = "v0.1.0";
  repo.write(".agents/skills.lock.json", lock);
  repo.write(".claude/repo-guard.config.json", {});
  const env = {
    FAKE_FLOW_DOCTOR: '[{"name":"WorktreeRemove hook","ok":false,"detail":"not in .claude/settings.json"}]',
    FAKE_GUARD_DOCTOR: '[{"name":"sandbox","ok":false,"detail":"bubblewrap is missing"},{"name":"auto","ok":true}]',
    FAKE_CHECK_FAIL: "1",
  };

  const r = repo.cli(["doctor"], { env });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ issue-flow: WorktreeRemove hook: not in \.claude\/settings\.json/);
  assert.match(r.out, /✗ issue-flow: skills: close-pr en v0\.1\.0; issue-flow está en 0\.2\.0/);
  assert.match(r.out, /✗ skills: el disco, el lock y el manifiesto no coinciden/);
  assert.match(r.out, /· agent-cloud-kit: 0\.9\.0, hay 0\.9\.1/);
  assert.match(r.out, /✗ claude-repo-guard: sandbox: bubblewrap is missing/);
  assert.doesNotMatch(r.out, /claude-repo-guard: auto/);
  assert.equal(/✗ claude-repo-guard: weakerNetworkIsolation/.test(r.out), process.platform === "darwin");
});

test("doctor on an empty repo only notes what is not installed", () => {
  const repo = makeRepo();

  const r = repo.cli(["doctor"]);

  assert.equal(r.status, 0, r.out);
  assert.equal(r.out.trim().split("\n").filter((line) => line.startsWith("· ")).length, 4);
  assert.deepEqual(repo.calls(), []);
});

test("doctor does not ask a flow that predates doctor --json, and says to update it", () => {
  const repo = installedRepo({ flow: "0.1.0" });

  const r = repo.cli(["doctor"]);

  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /· issue-flow: 0\.1\.0 no tiene doctor --json: corre npx agent-kitchen apply para actualizarlo/);
  assert.ok(repo.calls().every((args) => !args[0].startsWith("@ramon-sg/issue-flow")));
});

test("doctor notes a piece the repo left out and does not ask its tool", () => {
  const repo = installedRepo();
  repo.write(".agents/kitchen.json", { pieces: { "claude-repo-guard": false } });

  const r = repo.cli(["doctor"]);

  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /· claude-repo-guard: fuera por decisión del repo/);
  assert.ok(repo.allCalls().every((args) => !args[0].startsWith("github:ramon-sg/claude-repo-guard")));
});

// A PATH where bunx is missing: the fake npx, node, and the system's own folders.
const pathWithoutBunx = (repo) => {
  const dir = join(repo.tmp, "nobun");
  mkdirSync(dir);
  symlinkSync(process.execPath, join(dir, "node"));
  symlinkSync(join(repo.tmp, "bin", "npx"), join(dir, "npx"));
  return `${dir}:/usr/bin:/bin`;
};

// What runner.json pins for installedRepo's pieces, so their checks pass in runner mode.
const PINNED = { "@ramon-sg/issue-flow": "0.2.0", "@ramon-sg/skills-manager": "1.5.0", "@ramon-sg/claude-repo-guard": "0.8.0", "agent-cloud-kit": "0.9.1" };

test("doctor shows one runner line when the repo has runner.json and its bunx runs", () => {
  const repo = installedRepo();
  repo.write(".agents/runner.json", { runner: "bun", tools: PINNED });

  const r = repo.cli(["doctor"]);

  assert.match(r.out, /✓ runner: /);
  assert.equal(r.out.split("\n").filter((line) => /^\S+ runner:/.test(line)).length, 1);
  assert.equal(r.status, 0);
});

test("doctor in runner mode runs the guard from npm with bunx, like the other tools, with no stack trace", () => {
  const repo = installedRepo();
  repo.write(".agents/runner.json", { runner: "bun", tools: PINNED });

  const r = repo.cli(["doctor"]);

  assert.doesNotMatch(r.err + r.out, /\n\s+at .*\(/);
  const calls = repo.allCalls().map((args, i) => ({ args, program: repo.programs()[i] }));
  assert.ok(calls.some((c) => c.args.join(" ") === "@ramon-sg/claude-repo-guard@0.8.0 doctor --json" && c.program === "bunx"));
  assert.ok(calls.every((c) => !c.args[0].startsWith("github:") && c.program === "bunx"));
});

test("doctor in runner mode fails the guard when its manifest is there but runner.json does not pin it", () => {
  const repo = installedRepo();
  repo.write(".agents/runner.json", { runner: "bun", tools: {} });

  const r = repo.cli(["doctor"]);

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ claude-repo-guard: .*runner\.json no lo fija/);
  assert.ok(repo.allCalls().every((args) => !args[0].includes("claude-repo-guard")));
});

test("doctor fails the runner line when bunx is not on the PATH", () => {
  const repo = installedRepo();
  repo.write(".agents/runner.json", { runner: "bun", tools: PINNED });

  const r = repo.cli(["doctor"], { env: { PATH: pathWithoutBunx(repo) } });

  assert.match(r.out, /✗ runner: .*bunx/);
  assert.equal(r.status, 1);
});

test("doctor has no runner line in a repo without runner.json", () => {
  const r = installedRepo().cli(["doctor"]);

  assert.doesNotMatch(r.out, /runner:/);
});

for (const command of ["doctor", "apply"]) {
  test(`${command} stops with the error block on an invalid runner.json, with no stack`, () => {
    const repo = installedRepo();
    repo.write(".agents/runner.json", { runner: "deno" });

    const r = repo.cli(command === "apply" ? ["apply", "--yes"] : [command]);

    assert.equal(r.status, 1);
    assert.match(r.err, /\.agents\/runner\.json/);
    assert.doesNotMatch(r.err, /\n\s+at /);
    assert.doesNotMatch(r.err, /RunnerFileError/);
  });
}
