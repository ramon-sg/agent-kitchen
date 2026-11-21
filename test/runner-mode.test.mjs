// The tools run with the runner `.agents/runner.json` names: Bun (`bunx --bun`) unless it says
// node (`npx --yes`). A repo without that file runs them with npx, as before.
import assert from "node:assert/strict";
import { test } from "node:test";
import { repoMode, toolText } from "../dist/tools.js";
import { installedRepo, makeFreshRepo, makeRepo } from "./helpers.mjs";

// The versions installedRepo has, as runner.json pins them.
const TOOLS = {
  "@ramon-sg/issue-flow": "0.2.0",
  "@ramon-sg/github-rest": "0.2.1",
  "@ramon-sg/skills-manager": "1.2.0",
  "@ramon-sg/claude-repo-guard": "0.2.0",
  "agent-cloud-kit": "0.9.0",
};

// A spec with an exact version, like @ramon-sg/issue-flow@0.2.0.
const EXACT_SPEC = /^(@[a-z0-9-]+\/)?[a-z0-9-]+@\d+\.\d+\.\d+$/;

test("without runner.json the tools run with npx, as before", () => {
  const repo = installedRepo({ cloud: "0.9.0" });

  const r = repo.cli(["apply", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.programs().length > 0);
  assert.deepEqual([...new Set(repo.programs())], ["npx"]);
});

test("with runner node the tools run with npx", () => {
  const repo = installedRepo({ cloud: "0.9.0" });
  repo.write(".agents/runner.json", { runner: "node", tools: TOOLS });

  const r = repo.cli(["apply", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.programs().length > 0);
  assert.deepEqual([...new Set(repo.programs())], ["npx"]);
});

test("with runner.json and no runner the tools run with bunx --bun, each at an exact version", () => {
  const repo = installedRepo({ cloud: "0.9.0" });
  repo.write(".agents/runner.json", { tools: TOOLS });

  const r = repo.cli(["apply", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.programs().length > 0);
  assert.deepEqual([...new Set(repo.programs())], ["bunx"]);
  assert.ok(repo.log().filter((call) => call.program === "bunx").every((call) => call.args[0] === "--bun"));
  for (const args of repo.allCalls()) assert.match(args[0], EXACT_SPEC);
  assert.ok(repo.calls().some((args) => args.join(" ") === "agent-cloud-kit@0.9.1 init"));
});

test("a step that fails with Bun says how to run it by hand with bunx --bun", () => {
  const repo = installedRepo({ cloud: "0.9.0" });
  repo.write(".agents/runner.json", { tools: TOOLS });

  const r = repo.cli(["apply", "--yes"], { env: { FAKE_FAIL: "agent-cloud-kit" } });

  assert.equal(r.status, 1);
  assert.match(r.err, /agent-cloud-kit init falló; corre 'bunx --bun agent-cloud-kit@0\.9\.1 init'/);
});

test("repoMode and toolText follow runner.json; a runner does not take a GitHub spec", () => {
  const repo = makeRepo();
  const args = ["agent-cloud-kit@1.1.0", "init", "--name", "a b"];

  assert.deepEqual(repoMode(repo.main), { kind: "legacy" });
  assert.equal(toolText(repo.main, args), "npx agent-cloud-kit@1.1.0 init --name a b");
  assert.equal(toolText(repo.main, ["github:ramon-sg/claude-repo-guard#v0.2.0", "doctor"]), "npx github:ramon-sg/claude-repo-guard#v0.2.0 doctor");

  repo.write(".agents/runner.json", { runner: "node", tools: {} });
  assert.deepEqual(repoMode(repo.main), { kind: "runner", runner: "node", tools: {} });
  assert.equal(toolText(repo.main, ["@ramon-sg/issue-flow@0.2.0", "doctor"]), "npx --yes @ramon-sg/issue-flow@0.2.0 doctor");

  repo.write(".agents/runner.json", { tools: { "agent-cloud-kit": "1.1.0" } });
  assert.deepEqual(repoMode(repo.main), { kind: "runner", runner: "bun", tools: { "agent-cloud-kit": "1.1.0" } });
  assert.equal(toolText(repo.main, args), "bunx --bun agent-cloud-kit@1.1.0 init --name 'a b'");
  assert.throws(() => toolText(repo.main, ["github:ramon-sg/claude-repo-guard#v0.2.0", "doctor"]), /with a version/);
  assert.throws(() => toolText(repo.main, ["@ramon-sg/issue-flow", "doctor"]), /with a version/);
});

// --runner: apply changes the runner of a repo in runner mode (runner.json, each tool's apply at its
// pinned version, packageManager), or runs the move of a legacy repo with that runner.
const LATEST = {
  "@ramon-sg/issue-flow": "0.6.0",
  "@ramon-sg/github-rest": "0.7.0",
  "@ramon-sg/skills-manager": "1.5.1",
  "@ramon-sg/claude-repo-guard": "0.8.0",
  "agent-cloud-kit": "1.0.0",
};
// The runs that change the repo: each tool's apply, init or install, not the reads before them (doctor, labels, candidates).
const applies = (repo) => repo.log().filter((call) => ["npx", "bunx"].includes(call.program) && call.args.some((arg) => ["apply", "init", "install"].includes(arg)));
const change = { env: { FAKE_NPM: JSON.stringify(LATEST) } };

// A repo in runner mode with every tool pinned at its latest, so nothing else is offered.
function runnerRepo({ runner = "bun", pkg } = {}) {
  const repo = installedRepo({ flow: "0.6.0", cloud: "1.0.0", guard: "0.8.0", tags: { "ramon-sg/claude-repo-guard": ["0.7.0"], "ramon-sg/agent-skills": ["0.2.0"] } });
  repo.write(".agents/runner.json", { runner, tools: LATEST });
  repo.write("package.json", pkg ?? { scripts: { test: "node --test" } });
  repo.write(".claude/cloud.json", {});
  return repo;
}

test("--runner node in a bun repo writes node and reruns each tool's apply with npx at its pinned version", () => {
  const repo = runnerRepo();

  const r = repo.cli(["apply", "--yes", "--runner", "node"], change);

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.equal(repo.read(".agents/runner.json").runner, "node");
  assert.deepEqual(repo.read(".agents/runner.json").tools, LATEST);
  const texts = repo.calls().map((args) => args.join(" "));
  for (const text of ["@ramon-sg/issue-flow@0.6.0 apply --yes --json", "@ramon-sg/claude-repo-guard@0.8.0 apply --yes", "agent-cloud-kit@1.0.0 init", "@ramon-sg/skills-manager@1.5.1 install"]) assert.ok(texts.includes(text), `${text} in ${texts}`);
  assert.deepEqual([...new Set(applies(repo).map((call) => call.program))], ["npx"]);
  assert.match(JSON.stringify(repo.read(".claude/settings.json")), /npx --yes @ramon-sg\/issue-flow@0\.6\.0/);
});

test("--runner bun in a node repo reruns the tools with bunx", () => {
  const repo = runnerRepo({ runner: "node" });

  const r = repo.cli(["apply", "--yes", "--runner", "bun"], change);

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.equal(repo.read(".agents/runner.json").runner, "bun");
  assert.deepEqual([...new Set(applies(repo).map((call) => call.program))], ["bunx"]);
});

test("--runner with the runner the repo has rewrites with it: it offers the step and reruns every tool's apply, leaving runner.json as it is", () => {
  const repo = runnerRepo({ pkg: { packageManager: "npm@10.0.0" } });
  const before = repo.read(".agents/runner.json");

  const r = repo.cli(["apply", "--yes", "--runner", "bun"], change);

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.match(r.out, /Hooks y atajos reescritos con el ejecutor bun/);
  assert.deepEqual(repo.read(".agents/runner.json"), before);
  assert.equal(applies(repo).length, 4);
});

test("a change cut short by a failed tool is finished by the same --runner again", () => {
  const repo = runnerRepo();

  const first = repo.cli(["apply", "--yes", "--runner", "node"], { env: { ...change.env, FAKE_FAIL: "claude-repo-guard" } });
  const second = repo.cli(["apply", "--yes", "--runner", "node"], change);

  assert.equal(first.status, 1);
  assert.equal(second.status, 0, `${second.out}\n${second.err}`);
  const guard = applies(repo).filter((call) => call.args.some((arg) => arg.startsWith("@ramon-sg/claude-repo-guard@")));
  assert.deepEqual(guard.map((call) => call.program), ["npx"]);
  assert.equal(repo.read(".agents/runner.json").runner, "node");
});

test("--runner that produces no step says so and why", () => {
  const repo = runnerRepo();

  const r = repo.cli(["apply", "--yes", "--skip", "runner", "--runner", "node"], change);

  assert.match(r.err + r.out, /--runner no tuvo efecto: la pieza runner está fuera de esta corrida/);
  assert.equal(repo.read(".agents/runner.json").runner, "bun");
});

test("--runner with --dry-run shows the step and writes nothing", () => {
  const repo = runnerRepo();
  const before = repo.read(".agents/runner.json");

  const r = repo.cli(["apply", "--dry-run", "--runner", "node"], change);

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.match(r.out, /Cambiar el ejecutor de bun a node/);
  assert.deepEqual(repo.read(".agents/runner.json"), before);
  assert.deepEqual(applies(repo), []);
});

test("a tool that fails does not stop the change: runner.json is written, the failure is named, the others run", () => {
  const repo = runnerRepo();

  const r = repo.cli(["apply", "--yes", "--runner", "node"], { env: { ...change.env, FAKE_FAIL: "claude-repo-guard" } });

  assert.equal(r.status, 1);
  assert.equal(repo.read(".agents/runner.json").runner, "node");
  assert.ok(repo.calls().some((args) => args.join(" ") === "agent-cloud-kit@1.0.0 init"));
});

test("--runner node takes packageManager out of a repo with no dependencies of its own", () => {
  const repo = runnerRepo({ pkg: { packageManager: "bun@1.3.0", scripts: { test: "node --test" } } });

  const r = repo.cli(["apply", "--yes", "--runner", "node"], change);

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.equal("packageManager" in repo.read("package.json"), false);
});

test("--runner bun sets packageManager to bun's own version in a repo with no dependencies of its own", () => {
  const repo = runnerRepo({ runner: "node", pkg: { scripts: { test: "node --test" } } });

  const r = repo.cli(["apply", "--yes", "--runner", "bun"], { env: { ...change.env, FAKE_BUN_VERSION: "1.4.4" } });

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.equal(repo.read("package.json").packageManager, "bun@1.4.4");
});

test("packageManager belongs to a repo with dependencies of its own: --runner leaves it", () => {
  const repo = runnerRepo({ pkg: { packageManager: "bun@1.3.0", dependencies: { react: "19.0.0" } } });

  const r = repo.cli(["apply", "--yes", "--runner", "node"], change);

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.equal(repo.read("package.json").packageManager, "bun@1.3.0");
  assert.equal(repo.read(".agents/runner.json").runner, "node");
});

test("--runner node in a new repo writes runner.json with node, whatever bunx is there", () => {
  const repo = makeFreshRepo();

  const r = repo.cli(["apply", "--yes", "--runner", "node"], change);

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.equal(repo.read(".agents/runner.json").runner, "node");
  assert.deepEqual([...new Set(repo.programs())], ["npx"]);
});

test("--runner deno is a usage error, and doctor takes no --runner", () => {
  const repo = makeRepo();

  const bad = repo.cli(["apply", "--runner", "deno"]);
  const doctor = repo.cli(["doctor", "--runner", "node"]);

  assert.equal(bad.status, 2);
  assert.match(bad.err, /--runner espera bun o node: deno/);
  assert.match(bad.err, /Uso:/);
  assert.equal(doctor.status, 2);
  assert.match(doctor.err, /Uso:/);
});
