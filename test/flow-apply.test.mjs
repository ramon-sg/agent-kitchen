// Tests of `issue-flow apply`: from 0.3.0, agent-kitchen installs, updates and repairs the
// flow with it, reads its --json, and then moves the flow's skills to the version's tag.
// Before 0.3.0 it runs init and upgrade, as it did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installedRepo, makeRepo, NPM } from "./helpers.mjs";

const FLOW = "@ramon-sg/issue-flow";

// The npm latest, with the flow at a version.
const npm = (version) => JSON.stringify({ ...NPM, [FLOW]: version });

// Every piece but the flow, so only its steps run.
const ONLY = ["--skip", "skills-manager,claude-cloud,claude-repo-guard,skills,agents-md"];

// The flow's own commands of the last run, as text, without its version.
const flowCalls = (repo) => repo.calls().filter((args) => args[0].startsWith(`${FLOW}@`)).map((args) => args.slice(1).join(" "));

// What the flow's doctor --json prints, with these checks failing.
const doctor = (...failing) => JSON.stringify([{ name: ".agents/flow.json", ok: true, detail: "valid" }, { name: "SessionStart hook", ok: true, detail: "0.3.0" }, ...failing.map(([name, detail]) => ({ name, ok: false, detail }))]);

// A repo with the flow's catalog in its manifest but without the flow in package.json.
function repoWithFlowSkills() {
  const repo = makeRepo();
  repo.write("package.json", { devDependencies: { "@ramon-sg/skills-manager": "1.2.0" } });
  repo.write(".agents/skills.json", { sources: [{ catalog: "ramon-sg/issue-flow", ref: "v0.2.0", skills: ["close-pr"] }] });
  repo.write(".agents/skills.lock.json", { lockVersion: 2, skills: { "close-pr": { source: "catalog:ramon-sg/issue-flow", tag: "v0.2.0" } } });
  return repo;
}

test("installing 0.3.0 runs its apply, not init, and then puts the flow's skills at its tag", () => {
  const repo = repoWithFlowSkills();

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.0") } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ issue-flow 0\.3\.0 instalado: config del flujo, hooks y scripts \(\d+,\d s\)/);
  assert.ok(flowCalls(repo).includes("apply --yes --json"));
  assert.ok(!flowCalls(repo).includes("init --yes"));
  assert.equal(repo.read("package.json").devDependencies[FLOW], "0.3.0");
  assert.equal(repo.read(".agents/skills.json").sources[0].ref, "v0.3.0");
  assert.deepEqual(repo.calls().at(-1), ["@ramon-sg/skills-manager@1.2.0", "update", "close-pr"]);
});

test("updating 0.2.7 to 0.3.0 runs the new one's apply, then moves the flow's skills", () => {
  const repo = installedRepo({ flow: "0.2.7" });

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.0") } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ issue-flow actualizado de 0\.2\.7 a 0\.3\.0/);
  assert.deepEqual(repo.calls().filter((args) => args[1] === "apply"), [[`${FLOW}@0.3.0`, "apply", "--yes", "--json"]]);
  assert.ok(!flowCalls(repo).includes("upgrade"));
  assert.equal(repo.read(".agents/skills.lock.json").skills["close-pr"].tag, "v0.3.0");
});

test("with a flow older than 0.3.0 on npm, it still runs init and upgrade", () => {
  const fresh = makeRepo();
  const installed = fresh.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.2.6") } });
  assert.equal(installed.status, 0, installed.err);
  assert.ok(flowCalls(fresh).includes("init --yes"));

  const old = installedRepo({ flow: "0.2.0" });
  const updated = old.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.2.6") } });
  assert.equal(updated.status, 0, updated.err);
  assert.ok(flowCalls(old).includes("upgrade"));
  assert.ok(![...flowCalls(fresh), ...flowCalls(old)].some((call) => call.startsWith("apply")));
});

test("when apply refuses, its step fails with its reason and how to retry", () => {
  const repo = installedRepo({ flow: "0.2.7" });
  const reason = "issue-flow: .claude/settings.json has issue-flow 0.4.0, newer than this 0.3.0";

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_FLOW_APPLY_ERROR: reason } });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ Falló: Actualizar issue-flow 0\.2\.7 → 0\.3\.0, con sus hooks y sus skills \(\d+,\d s\)/);
  assert.match(r.err, /issue-flow apply falló; corre 'npx @ramon-sg\/issue-flow@0\.3\.0 apply --yes'/);
  assert.ok(r.err.includes(reason));
  assert.equal(repo.read(".agents/skills.lock.json").skills["close-pr"].tag, "v0.2.7");
});

test("an apply that exits 0 without its JSON fails too: it is not known what it wrote", () => {
  const repo = installedRepo({ flow: "0.2.7" });

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_FLOW_APPLY_OUT: "done\n" } });

  assert.equal(r.status, 1);
  assert.match(r.err, /issue-flow apply no dijo qué hizo; corre 'npx @ramon-sg\/issue-flow@0\.3\.0 apply --yes'/);
});

test("what apply keeps as it was shows as a note of the step", () => {
  const repo = installedRepo({ flow: "0.2.7" });
  const kept = "package.json: kept @ramon-sg/github-rest 0.2.1 (the skills need 0.3.0 or newer: raise it)";

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_FLOW_KEPT: kept } });

  assert.equal(r.status, 0, r.err);
  assert.ok(r.out.includes(`· ${kept}`));
});

test("at 0.3.0 and up to date, a stale hook or $schema offers to repair with apply; other failures do not", () => {
  const offered = (failing) => {
    const repo = installedRepo({ flow: "0.3.0" });
    const r = repo.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_FLOW_DOCTOR: doctor(...failing) } });
    assert.equal(r.status, 0, r.err);
    return /\[x\] Reparar issue-flow 0\.3\.0: hooks y \$schema/.test(r.out);
  };
  assert.ok(offered([["WorktreeCreate hook", "at 0.2.7, this is 0.3.0: run npx @ramon-sg/issue-flow apply"]]));
  assert.ok(offered([[".agents/flow.json", "valid, but its $schema is not at v0.3.0: run npx @ramon-sg/issue-flow apply"]]));
  assert.ok(!offered([]));
  assert.ok(!offered([["@ramon-sg/github-rest", "0.2.1, and the skills need 0.3.0 or newer: raise it in package.json"]]));
  assert.ok(!offered([[".agents/flow.json", "branch.template must be a string"]]));

  const repo = installedRepo({ flow: "0.3.0" });
  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_FLOW_DOCTOR: doctor(["SessionStart hook", "at 0.2.7"]) } });
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ issue-flow 0\.3\.0 reparado/);
  assert.ok(flowCalls(repo).includes("apply --yes --json"));
});

test("the flow's doctor runs in the status only from 0.3.0, also with npm down", () => {
  const old = installedRepo({ flow: "0.2.7" });
  const r = old.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.2.7") } });
  assert.equal(r.status, 0, r.err);
  assert.ok(!flowCalls(old).some((call) => call.startsWith("doctor")));

  const offline = installedRepo({ flow: "0.3.0" });
  const down = offline.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: "{}", FAKE_FLOW_DOCTOR: doctor(["SessionStart hook", "at 0.2.7"]) } });
  assert.equal(down.status, 0, down.err);
  assert.match(down.out, /\[x\] Reparar issue-flow 0\.3\.0/);
});

test("a hook newer than the repo's version does not offer to repair: apply would refuse", () => {
  const repo = installedRepo({ flow: "0.3.0" });

  const r = repo.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_FLOW_DOCTOR: doctor(["SessionStart hook", "at 0.3.1, this is 0.3.0: run npx agent-kitchen apply"]) } });

  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(r.out, /Reparar/);
});

test("repairing after Dependabot raised package.json also moves the flow's skills to its tag", () => {
  const repo = installedRepo({ flow: "0.2.7" });
  repo.write("package.json", { devDependencies: { [FLOW]: "0.3.0", "@ramon-sg/github-rest": "0.3.0", "@ramon-sg/skills-manager": "1.2.0" } });

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_FLOW_DOCTOR: doctor(["SessionStart hook", "at 0.2.7, this is 0.3.0"]) } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ issue-flow 0\.3\.0 reparado/);
  assert.equal(repo.read(".agents/skills.lock.json").skills["close-pr"].tag, "v0.3.0");
  assert.ok(repo.calls().some((args) => args[1] === "update"));
});

test("from 0.3.0 to a newer one, it updates and does not run the doctor nor offer to repair", () => {
  const repo = installedRepo({ flow: "0.3.0" });

  const r = repo.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.3.1"), FAKE_FLOW_DOCTOR: doctor(["SessionStart hook", "at 0.2.7"]) } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /\[x\] Actualizar issue-flow 0\.3\.0 → 0\.3\.1/);
  assert.doesNotMatch(r.out, /Reparar/);
  assert.ok(!flowCalls(repo).some((call) => call.startsWith("doctor")));
});

test("updating does not also offer to repair", () => {
  const repo = installedRepo({ flow: "0.2.7" });

  const r = repo.cli(["--dry-run", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_FLOW_DOCTOR: doctor(["SessionStart hook", "at 0.2.6"]) } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /\[x\] Actualizar issue-flow 0\.2\.7 → 0\.3\.0/);
  assert.doesNotMatch(r.out, /Reparar/);
});

test("after installing with apply, the labels step runs", () => {
  const repo = makeRepo();
  const labels = JSON.stringify({ labels: [{ name: "spike", status: "to-create" }] });

  const r = repo.cli(["--yes", ...ONLY], { env: { FAKE_NPM: npm("0.3.0"), FAKE_LABELS: labels } });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(flowCalls(repo).filter((call) => !call.includes("--dry-run")), ["apply --yes --json", "labels sync"]);
});

test("in a repo without package.json, skills-manager is pinned in the package.json the flow's apply makes", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", "--skip", "claude-cloud,claude-repo-guard,agents-md"], { env: { FAKE_NPM: npm("0.3.0") } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ package\.json creado con skills-manager 1\.2\.0/);
  const pkg = repo.read("package.json");
  assert.equal(pkg.private, true);
  assert.equal(pkg.devDependencies["@ramon-sg/skills-manager"], "1.2.0");
  assert.equal(pkg.devDependencies[FLOW], "0.3.0");
  assert.equal(repo.calls().find((args) => args[1] === "init" && args[0].includes("skills-manager"))?.[0], "@ramon-sg/skills-manager@1.2.0");

  const alone = makeRepo();
  const skipped = alone.cli(["--yes", "--skip", "issue-flow,claude-cloud,claude-repo-guard,agents-md"]);
  assert.equal(skipped.status, 0, skipped.err);
  assert.doesNotMatch(skipped.out, /package\.json/);
  assert.ok(!alone.exists("package.json"));
});
