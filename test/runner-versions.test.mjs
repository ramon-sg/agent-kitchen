// Where each piece's version comes from, and which version it may go to. In runner mode the
// versions are the ones `.agents/runner.json` pins and each tool goes to its latest, run with the
// repo's runner (the guard from npm, not GitHub). In legacy mode a tool only goes as far as the
// newest version below the first one that reads runner.json, so no tool moves to runner mode
// alone.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { toolText } from "../dist/tools.js";
import { installedRepo, makeRepo } from "./helpers.mjs";

// The first versions that read runner.json, and github-rest at issue-flow 0.6.0's floor.
const MINIMUMS = {
  "@ramon-sg/issue-flow": "0.6.0",
  "@ramon-sg/github-rest": "0.6.0",
  "@ramon-sg/skills-manager": "1.5.0",
  "@ramon-sg/claude-repo-guard": "0.8.0",
  "agent-cloud-kit": "1.0.0",
};

// The registry, one release past each minimum, and github-rest 0.7.0.
const LATEST = JSON.stringify({
  "@ramon-sg/issue-flow": "0.6.1",
  "@ramon-sg/github-rest": "0.7.0",
  "@ramon-sg/skills-manager": "1.5.1",
  "@ramon-sg/claude-repo-guard": "0.8.1",
  "agent-cloud-kit": "1.0.1",
});

// GitHub without any tag of the guard: in runner mode it is looked up on npm.
const NO_GUARD_TAGS = { "ramon-sg/agent-skills": ["0.1.0", "0.2.0"] };

// A repo in runner mode at the minimums, with other numbers in package.json, cloud.json and the
// guard's manifest on purpose: none of them is where a runner repo keeps its versions.
function runnerRepo(tools = MINIMUMS) {
  const repo = installedRepo({ flow: "0.6.0", cloud: "0.9.0", guard: "0.2.0", tags: NO_GUARD_TAGS });
  repo.write("package.json", { devDependencies: { "@ramon-sg/issue-flow": "0.2.0", "@ramon-sg/github-rest": "0.2.1", "@ramon-sg/skills-manager": "1.2.0" } });
  repo.write(".agents/runner.json", { tools });
  return repo;
}

// The SessionStart commands of .claude/settings.json.
const sessionStart = (repo) => (repo.exists(".claude/settings.json") ? (repo.read(".claude/settings.json").hooks?.SessionStart ?? []).flatMap((group) => group.hooks.map((hook) => hook.command)) : []);

// A git first in PATH that logs its arguments to <tmp>/git.log and runs the real one.
function loggedGit(repo) {
  const dir = join(repo.tmp, "gitlog");
  mkdirSync(dir);
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  writeFileSync(join(dir, "git"), `#!/bin/sh\necho "$*" >> "${join(repo.tmp, "git.log")}"\nexec "${real}" "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  return { PATH: `${dir}:${join(repo.tmp, "bin")}:${process.env.PATH}`, read: () => (existsSync(join(repo.tmp, "git.log")) ? readFileSync(join(repo.tmp, "git.log"), "utf8") : "") };
}

test("in runner mode the table shows each piece's version from runner.json, and the guard's latest from npm", () => {
  const repo = runnerRepo();
  const git = loggedGit(repo);

  const r = repo.cli(["apply", "--dry-run"], { env: { FAKE_NPM: LATEST, PATH: git.PATH } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +0\.6\.0, hay 0\.6\.1/);
  assert.match(r.out, /skills-manager +1\.5\.0, hay 1\.5\.1/);
  assert.match(r.out, /agent-cloud-kit +1\.0\.0, hay 1\.0\.1/);
  assert.match(r.out, /claude-repo-guard +0\.8\.0, hay 0\.8\.1/);
  assert.doesNotMatch(r.out, /0\.2\.0|1\.2\.0|0\.9\.0/);
  assert.doesNotMatch(r.out, /GitHub no tiene una versión/);
  assert.match(git.read(), /ls-remote .*ramon-sg\/agent-skills/, "the logged git ran");
  assert.doesNotMatch(git.read(), /ls-remote .*claude-repo-guard/);
});

test("in runner mode apply --yes updates each piece with bunx --bun at its latest, and runner.json follows", () => {
  const repo = runnerRepo();

  const r = repo.cli(["apply", "--yes"], { env: { FAKE_NPM: LATEST } });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual([...new Set(repo.programs())], ["bunx"]);
  const calls = repo.calls().map((args) => args.join(" "));
  for (const call of ["@ramon-sg/issue-flow@0.6.1 apply --yes --json", "agent-cloud-kit@1.0.1 init", "@ramon-sg/claude-repo-guard@0.8.1 apply --yes", "@ramon-sg/skills-manager@1.5.1 install"]) assert.ok(calls.includes(call), `${call} in ${calls.join("\n")}`);
  assert.ok(calls.every((call) => !call.startsWith("github:")), calls.join("\n"));
  assert.deepEqual(repo.read(".agents/runner.json").tools, {
    "@ramon-sg/claude-repo-guard": "0.8.1",
    "@ramon-sg/github-rest": "0.7.0",
    "@ramon-sg/issue-flow": "0.6.1",
    "@ramon-sg/skills-manager": "1.5.1",
    "agent-cloud-kit": "1.0.1",
  });
  // The fixture's cloud.json version is a legacy leftover: the runner piece's finishing step takes it out, and nothing writes a new one.
  assert.equal("version" in repo.read(".claude/cloud.json"), false, "agent-kitchen does not write cloud.json's version in runner mode");
  assert.match(r.out, /bunx --bun agent-cloud-kit@1\.0\.1 prepare/);
});

test("in legacy mode issue-flow goes only as far as the newest version below 0.6.0", () => {
  const repo = installedRepo({ flow: "0.5.1" });
  const only = ["--skip", "skills-manager,agent-cloud-kit,claude-repo-guard,skills,agents-md"];

  const both = repo.cli(["apply", "--dry-run", ...only], { env: { FAKE_NPM: JSON.stringify({ "@ramon-sg/issue-flow": "0.6.0" }), FAKE_NPM_VERSIONS: JSON.stringify({ "@ramon-sg/issue-flow": ["0.5.1", "0.5.2", "0.6.0"] }) } });
  const onlyMinimum = repo.cli(["apply", "--dry-run", ...only], { env: { FAKE_NPM: JSON.stringify({ "@ramon-sg/issue-flow": "0.6.0" }), FAKE_NPM_VERSIONS: JSON.stringify({ "@ramon-sg/issue-flow": ["0.5.1", "0.6.0"] }) } });

  assert.equal(both.status, 0, both.err);
  assert.match(both.out, /\[x\] Actualizar issue-flow 0\.5\.1 → 0\.5\.2/);
  assert.doesNotMatch(both.out, /0\.6\.0/);
  assert.equal(onlyMinimum.status, 0, onlyMinimum.err);
  assert.doesNotMatch(onlyMinimum.out, /Actualizar issue-flow/);
  assert.match(onlyMinimum.out, /issue-flow +0\.5\.1, al día/);
});

test("in legacy mode claude-repo-guard goes only as far as the newest tag below v0.8.0", () => {
  const only = ["--skip", "skills-manager,issue-flow,agent-cloud-kit,skills,agents-md"];
  const both = installedRepo({ guard: "0.7.0", tags: { "ramon-sg/claude-repo-guard": ["0.7.0", "0.7.1", "0.8.0"], "ramon-sg/agent-skills": ["0.2.0"] } });
  const onlyMinimum = installedRepo({ guard: "0.7.0", tags: { "ramon-sg/claude-repo-guard": ["0.7.0", "0.8.0"], "ramon-sg/agent-skills": ["0.2.0"] } });

  const a = both.cli(["apply", "--dry-run", ...only]);
  const b = onlyMinimum.cli(["apply", "--dry-run", ...only]);

  assert.equal(a.status, 0, a.err);
  assert.match(a.out, /\[x\] Actualizar claude-repo-guard 0\.7\.0 → 0\.7\.1/);
  assert.doesNotMatch(a.out, /0\.8\.0/);
  assert.equal(b.status, 0, b.err);
  assert.doesNotMatch(b.out, /Actualizar claude-repo-guard/);
  assert.match(b.out, /claude-repo-guard +0\.7\.0, al día/);
});

test("in runner mode updating skills-manager pins its session-notice hook to the new version", () => {
  const repo = runnerRepo();
  repo.write(".claude/settings.json", { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "npx --yes @ramon-sg/skills-manager@1.2.0 session-notice" }] }, { hooks: [{ type: "command", command: "echo mine" }] }] } });

  const r = repo.cli(["apply", "--yes", "--skip", "issue-flow,agent-cloud-kit,claude-repo-guard,skills,agents-md"], { env: { FAKE_NPM: LATEST } });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(sessionStart(repo), ["bunx --bun @ramon-sg/skills-manager@1.5.1 session-notice", "echo mine"]);
  assert.equal(repo.read(".agents/runner.json").tools["@ramon-sg/skills-manager"], "1.5.1");
});

test("in runner mode skills-manager writes its session-notice hook when the repo has none", () => {
  const repo = runnerRepo();
  const runner = { runner: "node", tools: MINIMUMS };
  repo.write(".agents/runner.json", runner);

  const r = repo.cli(["apply", "--yes", "--skip", "issue-flow,agent-cloud-kit,claude-repo-guard,skills,agents-md"], { env: { FAKE_NPM: LATEST } });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(sessionStart(repo), ["npx --yes @ramon-sg/skills-manager@1.5.1 session-notice"]);
});

test("in runner mode, after issue-flow runs, github-rest rises to npm's latest when it is newer than the flow's floor", () => {
  const { "@ramon-sg/github-rest": _rest, ...tools } = MINIMUMS;
  const repo = runnerRepo(tools);

  const r = repo.cli(["apply", "--yes", "--skip", "skills-manager,agent-cloud-kit,claude-repo-guard,skills,agents-md"], { env: { FAKE_NPM: LATEST } });

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.allCalls().some((args) => args.join(" ") === "@ramon-sg/issue-flow@0.6.1 --version --json"));
  assert.equal(repo.read(".agents/runner.json").tools["@ramon-sg/github-rest"], "0.7.0");
});

test("in runner mode github-rest rises to the flow's floor when npm's latest is older, and never goes down", () => {
  const low = runnerRepo({ ...MINIMUMS, "@ramon-sg/github-rest": "0.5.0" });
  const high = runnerRepo({ ...MINIMUMS, "@ramon-sg/github-rest": "0.9.0" });
  const only = ["apply", "--yes", "--skip", "skills-manager,agent-cloud-kit,claude-repo-guard,skills,agents-md"];
  const env = { FAKE_NPM: JSON.stringify({ ...JSON.parse(LATEST), "@ramon-sg/github-rest": "0.6.0" }), FAKE_FLOW_REST: "0.6.5" };

  const a = low.cli(only, { env });
  const b = high.cli(only, { env });

  assert.equal(a.status, 0, a.err);
  assert.equal(low.read(".agents/runner.json").tools["@ramon-sg/github-rest"], "0.6.5");
  assert.equal(b.status, 0, b.err);
  assert.equal(high.read(".agents/runner.json").tools["@ramon-sg/github-rest"], "0.9.0");
});

test("a runner takes only a spec with an exact version", () => {
  const repo = makeRepo();
  repo.write(".agents/runner.json", { tools: {} });

  assert.throws(() => toolText(repo.main, ["github:ramon-sg/claude-repo-guard#v0.8.0", "apply"]), /with a version/);
  assert.throws(() => toolText(repo.main, ["@ramon-sg/skills-manager@1", "install"]), /with a version/);
  assert.throws(() => toolText(repo.main, ["@ramon-sg/skills-manager@^1.5.0", "install"]), /with a version/);
  assert.equal(toolText(repo.main, ["agent-cloud-kit@1.0.0-rc.1", "init"]), "bunx --bun agent-cloud-kit@1.0.0-rc.1 init");
});

test("in runner mode, a PR that fails to open says how to open it with the runner and runner.json's github-rest", () => {
  const repo = makeRepo({ origin: true });
  repo.write(".agents/runner.json", { tools: { "@ramon-sg/issue-flow": "0.6.0", "@ramon-sg/github-rest": "0.7.0" } });
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "runner");
  repo.git("push", "-q", "origin", "main");

  const r = repo.cli(["apply", "--yes", "--pr", "--skip", "skills-manager,agent-cloud-kit,claude-repo-guard,skills,agents-md"], { env: { FAKE_NPM: LATEST, FAKE_FAIL: "pr create" } });

  assert.equal(r.status, 1);
  assert.ok(repo.calls().some((args) => args.slice(0, 3).join(" ") === "@ramon-sg/github-rest@0.7.0 pr create"));
  assert.match(r.out, /bunx --bun @ramon-sg\/github-rest@0\.7\.0 pr create --head chore\/agent-kitchen-apply-\S+ --base main --title 'chore: agent-kitchen apply' --body \.\.\. --draft/);
});

// The registry with skills-manager 1.5.1 as latest, and 1.4.3 the newest below 1.5.0.
const SKILLS_MANAGER_NPM = { FAKE_NPM: JSON.stringify({ "@ramon-sg/issue-flow": "0.2.0", "agent-cloud-kit": "0.9.1", "@ramon-sg/skills-manager": "1.5.1" }), FAKE_NPM_VERSIONS: JSON.stringify({ "@ramon-sg/skills-manager": ["1.2.0", "1.4.3", "1.5.0", "1.5.1"] }) };

for (const [what, pin] of [["a range and no node_modules", "^1.2.0"], ["an exact pin of 1.5.1", "1.5.1"]]) {
  test(`in legacy mode skills-manager runs below 1.5.0 with ${what} in package.json`, () => {
    const repo = installedRepo();
    repo.write("package.json", { devDependencies: { "@ramon-sg/issue-flow": "0.2.0", "@ramon-sg/github-rest": "0.2.1", "@ramon-sg/skills-manager": pin } });

    const applied = repo.cli(["apply", "--yes"], { env: SKILLS_MANAGER_NPM });
    const applyCalls = repo.allCalls();
    const doctor = repo.cli(["doctor"], { env: SKILLS_MANAGER_NPM });
    const calls = [...applyCalls, ...repo.allCalls()].map((args) => args.join(" ")).filter((call) => call.includes("skills-manager"));

    assert.equal(applied.status, 0, applied.err);
    assert.ok(doctor.out.length > 0);
    assert.ok(calls.some((call) => call.startsWith("@ramon-sg/skills-manager@1.4.3 check")), calls.join("\n"));
    assert.ok(calls.length > 1 && calls.every((call) => call.startsWith("@ramon-sg/skills-manager@1.4.3 ")), calls.join("\n"));
    assert.equal(repo.exists(".agents/runner.json"), false);
  });
}

test("in legacy mode an issue-flow pin that already reads runner.json is shown and left alone: nothing runs at it", () => {
  const repo = installedRepo({ flow: "0.6.0" });
  const env = { FAKE_NPM: JSON.stringify({ "@ramon-sg/issue-flow": "0.6.1", "agent-cloud-kit": "0.9.1" }), FAKE_FLOW_DOCTOR: JSON.stringify([{ name: "SessionStart hook", ok: false, detail: "at 0.5.0" }]) };

  const r = repo.cli(["apply", "--yes", "--skip", "skills-manager,agent-cloud-kit,claude-repo-guard,skills,agents-md"], { env });
  const applyCalls = repo.allCalls();
  const doctor = repo.cli(["doctor"], { env });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +package\.json tiene 0\.6\.0, que ya lee \.agents\/runner\.json/);
  assert.deepEqual(applyCalls.filter((args) => args[0].startsWith("@ramon-sg/issue-flow")), []);
  assert.deepEqual(repo.allCalls().filter((args) => args[0].startsWith("@ramon-sg/issue-flow")), []);
  assert.match(doctor.out, /issue-flow: package\.json tiene 0\.6\.0, que ya lee/);
  assert.equal(repo.exists(".agents/runner.json"), false);
});
