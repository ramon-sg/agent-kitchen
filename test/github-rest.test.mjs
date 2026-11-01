// Tests of github-rest's minimum: from issue-flow 0.3.0, whose apply keeps an old github-rest,
// agent-kitchen raises an exact version below the one the flow's version asks for on npm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installedRepo, NPM } from "./helpers.mjs";

const FLOW = "@ramon-sg/issue-flow";
const REST = "@ramon-sg/github-rest";

// The npm latest, with the flow at a version.
const npm = (version) => JSON.stringify({ ...NPM, [FLOW]: version });

// What npm answers for the flow's dependencies: github-rest's range of each version.
const deps = (ranges) => JSON.stringify(Object.fromEntries(Object.entries(ranges).map(([version, range]) => [`${FLOW}@${version}`, { [REST]: range }])));

// Every piece but the flow, so only its steps run.
const ONLY = ["--skip", "skills-manager,claude-cloud,claude-repo-guard,skills,agents-md"];

// A repo with the flow and github-rest at these versions.
function repoWith(flow, rest) {
  const repo = installedRepo({ flow });
  repo.write("package.json", { devDependencies: { [FLOW]: flow, [REST]: rest, "@ramon-sg/skills-manager": "1.2.0" } });
  return repo;
}

test("updating the flow to 0.3.0 raises github-rest 0.2.1 to the 0.3.0 it asks for", () => {
  const repo = repoWith("0.2.7", "0.2.1");

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_NPM_DEPS: deps({ "0.3.0": "^0.3.0" }) } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ Subir github-rest 0\.2\.1 → 0\.3\.0, el mínimo de issue-flow 0\.3\.0/);
  assert.equal(repo.read("package.json").devDependencies[REST], "0.3.0");
  assert.equal(repo.read("package.json").devDependencies[FLOW], "0.3.0");
});

test("with the flow at 0.3.0 and up to date, it raises github-rest too", () => {
  const repo = repoWith("0.3.0", "0.2.1");

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_NPM_DEPS: deps({ "0.3.0": "^0.3.0" }) } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ Subir github-rest 0\.2\.1 → 0\.3\.0/);
  assert.equal(repo.read("package.json").devDependencies[REST], "0.3.0");
});

test("github-rest at the minimum or above, or a range, gets no step", () => {
  for (const rest of ["0.3.0", "0.4.0", "^0.2.0"]) {
    const repo = repoWith("0.3.0", rest);

    const r = repo.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_NPM_DEPS: deps({ "0.3.0": "^0.3.0" }) } });

    assert.equal(r.status, 0, r.err);
    assert.doesNotMatch(r.out, /github-rest/, rest);
  }
});

test("if the flow's update fails, github-rest is left as it was, saying why", () => {
  const repo = repoWith("0.2.7", "0.2.1");

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_NPM_DEPS: deps({ "0.3.0": "^0.3.0" }), FAKE_FLOW_APPLY_ERROR: "issue-flow: no" } });

  assert.notEqual(r.status, 0);
  assert.match(r.out, /no se subió: el repo no tiene issue-flow 0\.3\.0/);
  assert.equal(repo.read("package.json").devDependencies[REST], "0.2.1");
});

test("without npm's answer there is no step, and before 0.3.0 npm is not asked", () => {
  const down = repoWith("0.3.0", "0.2.1");
  const r = down.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.3.0") } });
  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(r.out, /github-rest/);

  const old = repoWith("0.2.0", "0.2.1");
  const before = old.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.2.6"), FAKE_NPM_DEPS: deps({ "0.2.6": "0.3.0" }) } });
  assert.equal(before.status, 0, before.err);
  assert.doesNotMatch(before.out, /github-rest/);
  assert.ok(!old.npmCalls().some((args) => args.includes("dependencies")));
});

test("the minimum is the one of the version the repo ends at, not of the one it had", () => {
  const repo = repoWith("0.3.0", "0.3.0");

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.1"), FAKE_NPM_DEPS: deps({ "0.3.0": "^0.3.0", "0.3.1": "~0.4.0" }) } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ Subir github-rest 0\.3\.0 → 0\.4\.0, el mínimo de issue-flow 0\.3\.1/);
  assert.equal(repo.read("package.json").devDependencies[REST], "0.4.0");
});
