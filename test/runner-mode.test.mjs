// The tools run with the runner `.agents/runner.json` names: Bun (`bunx --bun`) unless it says
// node (`npx --yes`). A repo without that file runs them with npx, as before.
import assert from "node:assert/strict";
import { test } from "node:test";
import { download, repoMode, toolText } from "../dist/tools.js";
import { installedRepo, makeRepo } from "./helpers.mjs";

// The versions installedRepo has, as runner.json pins them.
const TOOLS = {
  "@ramon-sg/issue-flow": "0.2.0",
  "@ramon-sg/github-rest": "0.2.1",
  "@ramon-sg/skills-manager": "1.2.0",
  "@ramon-sg/claude-repo-guard": "0.2.0",
  "agent-cloud-kit": "1.1.0",
};

// A spec with an exact version, like @ramon-sg/issue-flow@0.2.0.
const EXACT_SPEC = /^(@[a-z0-9-]+\/)?[a-z0-9-]+@\d+\.\d+\.\d+$/;

test("without runner.json the tools run with npx, as before", () => {
  const repo = installedRepo({ cloud: "1.0.0" });

  const r = repo.cli(["apply", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.programs().length > 0);
  assert.deepEqual([...new Set(repo.programs())], ["npx"]);
});

test("with runner node the tools run with npx", () => {
  const repo = installedRepo({ cloud: "1.0.0" });
  repo.write(".agents/runner.json", { runner: "node", tools: TOOLS });

  const r = repo.cli(["apply", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.programs().length > 0);
  assert.deepEqual([...new Set(repo.programs())], ["npx"]);
});

test("with runner.json and no runner the tools run with bunx --bun, each at an exact version", () => {
  const repo = installedRepo({ cloud: "1.0.0" });
  repo.write(".agents/runner.json", { tools: TOOLS });

  const r = repo.cli(["apply", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.programs().length > 0);
  assert.deepEqual([...new Set(repo.programs())], ["bunx"]);
  assert.ok(repo.log().filter((call) => call.program === "bunx").every((call) => call.args[0] === "--bun"));
  for (const args of repo.allCalls()) assert.match(args[0], EXACT_SPEC);
  assert.ok(repo.calls().some((args) => args.join(" ") === "agent-cloud-kit@1.1.0 init"));
});

test("a step that fails with Bun says how to run it by hand with bunx --bun", () => {
  const repo = installedRepo({ cloud: "1.0.0" });
  repo.write(".agents/runner.json", { tools: TOOLS });

  const r = repo.cli(["apply", "--yes"], { env: { FAKE_FAIL: "agent-cloud-kit" } });

  assert.equal(r.status, 1);
  assert.match(r.err, /agent-cloud-kit init falló; corre 'bunx --bun agent-cloud-kit@1\.1\.0 init'/);
});

test("repoMode and toolText follow runner.json; a runner takes no GitHub spec", () => {
  const repo = makeRepo();
  const args = ["agent-cloud-kit@1.1.0", "init", "--name", "a b"];

  assert.deepEqual(repoMode(repo.main), { kind: "legacy" });
  assert.equal(toolText(repo.main, args), "npx agent-cloud-kit@1.1.0 init --name a b");
  assert.equal(toolText(repo.main, ["github:ramon-sg/claude-repo-guard#v0.2.0", "doctor"]), "npx github:ramon-sg/claude-repo-guard#v0.2.0 doctor");

  repo.write(".agents/runner.json", { runner: "node", tools: {} });
  assert.deepEqual(repoMode(repo.main), { kind: "runner", runner: "node" });
  assert.equal(toolText(repo.main, ["@ramon-sg/issue-flow@0.2.0", "doctor"]), "npx --yes @ramon-sg/issue-flow@0.2.0 doctor");

  repo.write(".agents/runner.json", { tools: {} });
  assert.deepEqual(repoMode(repo.main), { kind: "runner", runner: "bun" });
  assert.equal(toolText(repo.main, args), "bunx --bun agent-cloud-kit@1.1.0 init --name 'a b'");
  assert.throws(() => toolText(repo.main, ["github:ramon-sg/claude-repo-guard#v0.2.0", "doctor"]), /GitHub spec/);
  assert.throws(() => toolText(repo.main, ["@ramon-sg/issue-flow", "doctor"]), /with a version/);
  assert.throws(() => download(repo.main, "github:ramon-sg/claude-repo-guard#v0.2.0"), /GitHub spec/);
});
