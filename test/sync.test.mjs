// Tests of the main command, `agent-kitchen`, on real checkouts: what it shows and offers for
// each piece, the order it runs the steps in with --yes, what it writes itself (the guard's
// options, the version of agent-cloud-kit, the flow catalog's tag) and what it leaves to each
// tool, through the fakes of fake-tools.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANDIDATES, installedRepo, makeRepo, npmCloud } from "./helpers.mjs";

const ALL_SKILLS = CANDIDATES.map((candidate) => candidate.id).join(",");

test("--dry-run on an empty repo shows the four pieces and the steps that install them, and changes nothing", () => {
  const repo = makeRepo();

  const r = repo.cli(["--dry-run"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +no instalado/);
  assert.match(r.out, /claude-repo-guard +no instalado/);
  assert.match(r.out, /\[x\] Instalar issue-flow 0\.2\.0: /);
  assert.match(r.out, /\[x\] Instalar agent-cloud-kit 1\.1\.0: /);
  assert.match(r.out, /\[x\] Instalar claude-repo-guard 0\.2\.0: /);
  assert.match(r.out, /\[x\] Instalar 4 skills de ramon-sg\/issue-flow y ramon-sg\/agent-skills/);
  assert.deepEqual(repo.calls(), []);
  assert.equal(repo.exists("package.json"), false);
});

test("--yes on an empty repo installs everything in order, each piece with its own tool, every skill offered at the flow's tag", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls(), [
    ["@ramon-sg/issue-flow@0.2.0", "init", "--yes"],
    ["agent-cloud-kit@1.1.0", "init"],
    ["github:ramon-sg/claude-repo-guard#v0.2.0", "install", "--yes"],
    ["@ramon-sg/skills-manager@1.2.0", "init", "--catalog", "ramon-sg/issue-flow#v0.2.0", "--catalog", "ramon-sg/agent-skills", "--select", ALL_SKILLS],
  ]);
  const guard = repo.read(".claude/repo-guard.config.json");
  assert.match(guard.environment[0], /draft PR/);
  assert.equal(guard.weakerNetworkIsolation, process.platform === "darwin" ? true : undefined);
  assert.match(r.out, /^◒ Instalando issue-flow 0\.2\.0…$/m);
  assert.match(r.out, /✓ issue-flow 0\.2\.0 instalado: config del flujo, hooks y scripts \(\d+,\d s\)$/m);
  assert.doesNotMatch(r.out, /^→ /m);
  assert.deepEqual(repo.npmCalls().filter((args) => args[0] === "install"), [["install"]]);
  assert.match(r.out, /✓ Dependencias instaladas con npm/);
  assert.match(r.out, /\[ok\] Listo\.\n\n  Falta: revisa el diff y haz commit\./);
});

test("in the checkout, steps that leave package.json as it was do not install, even if it already had changes", () => {
  const repo = installedRepo({ cloud: "1.0.0" });
  const pkg = repo.read("package.json");
  repo.write("package.json", { ...pkg, scripts: { mio: "true" } });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(repo.read(".claude/cloud.json").version, "1.1.0");
  assert.deepEqual(repo.npmCalls().filter((args) => args[0] === "install"), []);
  assert.doesNotMatch(r.out, /install/);
  assert.match(r.out, /\[ok\] Listo\.\n\n  Falta: revisa el diff y haz commit\./);
});

test("in the checkout, a failed install is a failure and is left to do by hand", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", "--skip", "agent-cloud-kit,claude-repo-guard,skills"], { env: { FAKE_FAIL: "install" } });

  assert.equal(r.status, 1);
  assert.match(r.out, /^✗ Falló: Instalar las dependencias con npm \(\d+,\d s\)$/m);
  assert.match(r.err, /fake: npm install failed/);
  assert.match(r.out, /\[!\] Terminó, pero fallaron: Instalar las dependencias con npm\.\n\n  Falta: corre 'npm install', revisa el diff y haz commit\./);
});

test("the tools' output is hidden unless a step fails, and shown with --verbose", () => {
  const quiet = makeRepo();
  const loud = makeRepo();

  const r = quiet.cli(["--yes", "--skip", "agent-cloud-kit,claude-repo-guard,skills"], { env: { FAKE_SAY: "salida de la herramienta" } });
  const v = loud.cli(["--yes", "--verbose", "--skip", "agent-cloud-kit,claude-repo-guard,skills"], { env: { FAKE_SAY: "salida de la herramienta" } });

  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(`${r.out}${r.err}`, /salida de la herramienta/);
  assert.equal(v.status, 0, v.err);
  assert.match(`${v.out}${v.err}`, /salida de la herramienta/);
});

test("the repo's own skills are left out with --yes, and the rest are installed", () => {
  const repo = makeRepo();
  repo.write(".agents/skills/planning/SKILL.md", "propia");

  const r = repo.cli(["--yes", "--skip", "agent-cloud-kit,claude-repo-guard"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Se dejan fuera las skills que el repo ya tiene como propias: planning/);
  const select = repo.calls().at(-1);
  assert.equal(select[select.indexOf("--select") + 1], CANDIDATES.filter((candidate) => candidate.name !== "planning").map((candidate) => candidate.id).join(","));
  assert.ok(!select.includes("--replace"));
});

test("without a terminal nor --yes it only shows the steps", () => {
  const repo = makeRepo();

  const r = repo.cli(["apply"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /corre agent-kitchen apply en una terminal, o con --yes/);
  assert.deepEqual(repo.calls(), []);
});

test("a repo at the latest of everything has nothing to do, and asks skills-manager for skills it does not take", () => {
  const repo = installedRepo();
  const taken = JSON.stringify(CANDIDATES.filter((candidate) => ["close-pr", "pr-review-comments"].includes(candidate.name)));

  const r = repo.cli(["--yes"], { env: { FAKE_CANDIDATES: taken } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Todo al día: no hay nada que instalar ni actualizar/);
  assert.deepEqual(repo.allCalls(), [["@ramon-sg/skills-manager@1.2.0", "add", "--candidates", "--catalog", "ramon-sg/issue-flow#v0.2.0", "--catalog", "ramon-sg/agent-skills"]]);
});

test("--yes updates each piece behind: the flow and its skills, agent-cloud-kit's pin, the guard, the general skills", () => {
  const repo = installedRepo({ flow: "0.1.0", cloud: "1.0.0", guard: "0.1.0", general: "v0.1.0" });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls(), [
    ["@ramon-sg/issue-flow@0.2.0", "upgrade"],
    ["@ramon-sg/skills-manager@1.2.0", "update", "close-pr"],
    ["@ramon-sg/skills-manager@1.2.0", "update", "pr-review-comments"],
    ["agent-cloud-kit@1.1.0", "init"],
    ["github:ramon-sg/claude-repo-guard#v0.2.0", "install", "--yes"],
    ["@ramon-sg/skills-manager@1.2.0", "update", "code-audit"],
    ["@ramon-sg/skills-manager@1.2.0", "update", "test-audit"],
  ]);
  assert.deepEqual(Object.values(repo.read(".agents/skills.lock.json").skills).map((skill) => skill.tag), ["v0.2.0", "v0.2.0", "v0.2.0", "v0.2.0"]);
  assert.equal(repo.cli(["doctor"]).status, 0);
  assert.equal(repo.read(".claude/cloud.json").version, "1.1.0");
  assert.deepEqual(repo.read(".agents/skills.json").sources.map((source) => source.ref), ["v0.2.0", undefined]);
  assert.match(r.out, /issue-flow +0\.1\.0, hay 0\.2\.0/);
  assert.match(r.out, /✓ Skills de ramon-sg\/agent-skills actualizadas a v0\.2\.0: code-audit, test-audit/);
});

test("when only the flow's skills are off the CLI's tag, it moves them alone", () => {
  const repo = installedRepo();
  const lock = repo.read(".agents/skills.lock.json");
  lock.skills["close-pr"].tag = "v0.1.0";
  repo.write(".agents/skills.lock.json", lock);

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ Skills del flujo en v0\.2\.0/);
  assert.deepEqual(repo.calls().slice(-2), [["@ramon-sg/skills-manager@1.2.0", "update", "close-pr"], ["@ramon-sg/skills-manager@1.2.0", "update", "pr-review-comments"]]);
});

test("new skills in a catalog are offered unticked, and --yes leaves them", () => {
  const repo = installedRepo();

  const dry = repo.cli(["--dry-run"]);
  const yes = repo.cli(["--yes"]);

  assert.match(dry.out, /\[ \] Agregar skills nuevas \(2\): github-issues, planning/);
  assert.equal(yes.status, 0, yes.err);
  assert.match(yes.out, /Opcional, para elegir en una terminal: Agregar skills nuevas/);
  assert.equal(repo.calls().filter((args) => args[1] === "add").length, 0);
});

test("a guard at the latest without the flow's options gets them, at its own version", () => {
  const repo = installedRepo();
  repo.write(".claude/repo-guard.config.json", { weakerNetworkIsolation: true, allowedDomains: ["example.com"] });
  repo.write(".agents/flow.json", { baseBranch: "staging" });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ claude-repo-guard ajustado a lo que necesita el flujo de issues/);
  assert.match(r.out, /· rama de integración staging/);
  const guard = repo.read(".claude/repo-guard.config.json");
  assert.deepEqual(guard.allowedDomains, ["example.com"]);
  assert.equal(guard.integrationBranch, "staging");
  assert.match(guard.environment[0], /issue-flow is this repo's issue workflow/);
  assert.ok(repo.calls().some((args) => args.join(" ") === "github:ramon-sg/claude-repo-guard#v0.2.0 install --yes"));
});

test("a step that fails does not stop the rest, says how to retry, and exits 1", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes"], { env: { FAKE_FAIL: "agent-cloud-kit" } });

  assert.equal(r.status, 1);
  assert.match(r.err, /agent-cloud-kit init falló; corre 'npx agent-cloud-kit@1\.1\.0 init'/);
  assert.match(r.err, /fake: agent-cloud-kit failed/);
  assert.match(r.out, /✗ Falló: Instalar agent-cloud-kit/);
  assert.deepEqual(repo.calls().map((args) => args[0]), ["@ramon-sg/issue-flow@0.2.0", "agent-cloud-kit@1.1.0", "github:ramon-sg/claude-repo-guard#v0.2.0", "@ramon-sg/skills-manager@1.2.0"]);
  assert.match(r.out, /fallaron: Instalar agent-cloud-kit/);
});

test("when issue-flow did not install, the skills step leaves the flow's skills out instead of failing", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", "--skip", "agent-cloud-kit,claude-repo-guard"], { env: { FAKE_FAIL: "issue-flow@0.2.0 init" } });

  assert.equal(r.status, 1);
  assert.match(r.out, /sin las skills del flujo, porque issue-flow no está instalado/);
  // The skills-manager step made package.json before the flow failed, so its version runs.
  assert.deepEqual(repo.calls().at(-1), ["@ramon-sg/skills-manager@1.2.0", "init", "--catalog", "ramon-sg/agent-skills", "--select", "catalog:ramon-sg/agent-skills/planning"]);
});

test("--skip leaves pieces out; an unknown piece is a usage error", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes", "--skip", "agent-cloud-kit,skills"]);
  const unknown = repo.cli(["--yes", "--skip", "docker"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls().length, 0);
  assert.doesNotMatch(r.out, /agent-cloud-kit/);
  assert.equal(unknown.status, 2);
  assert.match(unknown.err, /no existe la pieza docker; son skills-manager, issue-flow, agent-cloud-kit, claude-repo-guard, skills/);
});

test("when npm and GitHub cannot tell the latest, a piece is shown and not updated", () => {
  const repo = installedRepo({ flow: "0.1.0", tags: {} });

  const r = repo.cli(["--yes"], { env: { FAKE_NPM: "{}" } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +0\.1\.0, al día \(npm no responde\)/);
  assert.match(r.out, /claude-repo-guard +0\.2\.0, al día \(GitHub no tiene una versión\)/);
  assert.doesNotMatch(r.out, /✓/);
});

test("it refuses to run in a worktree", () => {
  const repo = makeRepo();
  const dir = join(repo.tmp, "wt");
  repo.git("worktree", "add", "-q", "-b", "other", dir);

  const r = repo.cli(["--yes"], { cwd: dir });

  assert.equal(r.status, 1);
  assert.match(r.err, /corre agent-kitchen apply en la copia principal/);
  assert.deepEqual(repo.calls(), []);
});

test("without the issue flow, the guard is not told about it and the skills come from the general catalogs only", () => {
  const repo = makeRepo();

  const general = JSON.stringify(CANDIDATES.filter((candidate) => candidate.catalog === "ramon-sg/agent-skills"));

  const r = repo.cli(["--yes", "--skip", "issue-flow"], { env: { FAKE_CANDIDATES: general } });

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.allCalls().some((args) => args.includes("--candidates") && !args.includes("ramon-sg/issue-flow#v0.2.0")));
  assert.equal(repo.exists(".claude/repo-guard.config.json") ? repo.read(".claude/repo-guard.config.json").environment : undefined, undefined);
  assert.deepEqual(repo.calls().at(-1), ["@ramon-sg/skills-manager@1", "init", "--catalog", "ramon-sg/agent-skills", "--select", "catalog:ramon-sg/agent-skills/planning"]);
});

test("the latest tag is the highest version, not the last one as text", () => {
  const repo = installedRepo({ guard: "0.9.0", tags: { "ramon-sg/claude-repo-guard": ["0.9.0", "0.10.0"], "ramon-sg/agent-skills": ["0.2.0"] } });

  const r = repo.cli(["--dry-run"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /\[x\] Actualizar claude-repo-guard 0\.9\.0 → 0\.10\.0/);
});

test("when the flow is installed in this run, a guard already at the latest gets the flow's options too", () => {
  const repo = makeRepo();
  repo.write(".claude/repo-guard.manifest.json", { version: "0.2.0" });
  repo.write(".claude/repo-guard.config.json", { weakerNetworkIsolation: true });

  const r = repo.cli(["--yes", "--skip", "agent-cloud-kit,skills"]);

  assert.equal(r.status, 0, r.err);
  assert.match(repo.read(".claude/repo-guard.config.json").environment[0], /issue-flow is this repo's issue workflow/);
  assert.deepEqual(repo.calls(), [["@ramon-sg/issue-flow@0.2.0", "init", "--yes"], ["github:ramon-sg/claude-repo-guard#v0.2.0", "install", "--yes"]]);
});

test("on macOS a weakerNetworkIsolation the guard left false is offered as true", { skip: process.platform !== "darwin" }, () => {
  const repo = installedRepo();
  repo.write(".claude/repo-guard.config.json", { ...repo.read(".claude/repo-guard.config.json"), weakerNetworkIsolation: false });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(repo.read(".claude/repo-guard.config.json").weakerNetworkIsolation, true);
});

test("a flow version that is not an exact release is shown and left alone", () => {
  const repo = installedRepo();
  repo.write("package.json", { devDependencies: { "@ramon-sg/issue-flow": "file:../issue-flow", "@ramon-sg/skills-manager": "1.2.0" } });

  const r = repo.cli(["--dry-run", "--skip", "skills"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +package\.json tiene file:\.\.\/issue-flow, no una versión exacta/);
  assert.doesNotMatch(r.out, /\[x\] .*issue-flow/);
});

test("updating moves version and $schema of agent-cloud-kit", () => {
  const repo = installedRepo({ cloud: "1.0.0" });
  repo.write(".claude/cloud.json", { $schema: "https://unpkg.com/agent-cloud-kit@1.0.0/schema.json", version: "1.0.0", apt: ["jq"] });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.read(".claude/cloud.json"), { $schema: "https://unpkg.com/agent-cloud-kit@1.1.0/schema.json", version: "1.1.0", apt: ["jq"] });
});

test("updating runs init of the new version, after moving the version", () => {
  const repo = installedRepo({ cloud: "1.0.0" });

  const r = repo.cli(["--yes", "--skip", "issue-flow,claude-repo-guard,skills"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls(), [["agent-cloud-kit@1.1.0", "init"]]);
  assert.equal(repo.read(".claude/cloud.json").version, "1.1.0");
});

test("a failing init after an update fails the step", () => {
  const repo = installedRepo({ cloud: "1.0.0" });

  const r = repo.cli(["--yes", "--skip", "issue-flow,claude-repo-guard,skills"], { env: { FAKE_FAIL: "agent-cloud-kit" } });

  assert.equal(r.status, 1);
  assert.match(r.err, /agent-cloud-kit init falló; corre 'npx agent-cloud-kit@1\.1\.0 init'/);
});

test("after apply with the piece installed, the next step is printed", () => {
  const repo = installedRepo({ cloud: "1.0.0" });
  const upToDate = installedRepo();

  const r = repo.cli(["--yes"]);
  const same = upToDate.cli(["--yes"]);
  const skipped = installedRepo().cli(["--yes", "--skip", "agent-cloud-kit"]);
  const installedNow = makeRepo().cli(["--yes"]);

  assert.match(r.out.trimEnd(), /Siguiente paso para la nube:\n    npx agent-cloud-kit prepare$/);
  assert.match(same.out.trimEnd(), /Siguiente paso para la nube:\n    npx agent-cloud-kit prepare$/);
  assert.doesNotMatch(skipped.out, /Siguiente paso para la nube/);
  assert.match(installedNow.out.trimEnd(), /Siguiente paso para la nube:\n    npx agent-cloud-kit prepare$/);
});

test("a general catalog that follows a branch is not offered as behind, and skills already in the lock are not new", () => {
  const repo = installedRepo({ general: "v0.1.0" });
  const manifest = repo.read(".agents/skills.json");
  manifest.sources[1].ref = "main";
  repo.write(".agents/skills.json", manifest);

  const offered = JSON.stringify(CANDIDATES.filter((candidate) => ["pr-review-comments", "planning"].includes(candidate.name)));

  const r = repo.cli(["--dry-run"], { env: { FAKE_CANDIDATES: offered } });

  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(r.out, /Actualizar skills de ramon-sg\/agent-skills/);
  assert.match(r.out, /\[ \] Agregar skills nuevas \(1\): planning/);
});

test("the skills lock is where the manifest's paths.lock says", () => {
  const repo = installedRepo({ general: "v0.1.0" });
  const lock = repo.read(".agents/skills.lock.json");
  repo.write("tools/skills.lock.json", lock);
  repo.write(".agents/skills.lock.json", { lockVersion: 2, skills: {} });
  repo.write(".agents/skills.json", { ...repo.read(".agents/skills.json"), paths: { lock: "tools/skills.lock.json" } });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls().filter((args) => args[1] === "update").map((args) => args[2]), ["code-audit", "test-audit"]);
  assert.equal(repo.read("tools/skills.lock.json").skills["code-audit"].tag, "v0.2.0");
});

test("when npm has a newer agent-kitchen it runs that one with the same arguments, and that one does not hand over again", () => {
  const repo = makeRepo();
  const npm = JSON.stringify({ "agent-kitchen": "9.0.0", "@ramon-sg/issue-flow": "0.2.0", "agent-cloud-kit": "1.1.0" });

  const handed = repo.cli(["--dry-run", "--skip", "skills"], { env: { FAKE_NPM: npm } });
  const calls = repo.calls();
  const again = repo.cli(["--dry-run"], { env: { FAKE_NPM: npm, AGENT_KITCHEN_HANDED_OVER: "0.1.0" } });

  assert.equal(handed.status, 0, handed.err);
  assert.match(handed.err, /uso 9\.0\.0, la última/);
  assert.deepEqual(calls, [["agent-kitchen@9.0.0", "--dry-run", "--skip", "skills"]]);
  assert.doesNotMatch(handed.out, /Este repo tiene/);
  assert.equal(again.status, 0, again.err);
  assert.match(again.out, /Este repo tiene/);
});

test("the guard updates with apply from 0.5.0 on, as the issue's repro: 0.5.0 → 0.5.1", () => {
  const repo = installedRepo({ guard: "0.5.0", tags: { "ramon-sg/claude-repo-guard": ["0.5.0", "0.5.1"], "ramon-sg/agent-skills": ["0.2.0"] } });

  const r = repo.cli(["--yes", "--skip", "issue-flow,agent-cloud-kit,skills"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /✓ claude-repo-guard actualizado de 0\.5\.0 a 0\.5\.1/);
  assert.ok(repo.calls().some((args) => args.join(" ") === "github:ramon-sg/claude-repo-guard#v0.5.1 apply --yes"));
  assert.equal(repo.read(".claude/repo-guard.manifest.json").version, "0.5.1");
});

test("a guard before 0.5.0 still gets its options with install, at its own version", () => {
  const repo = installedRepo({ guard: "0.4.1", tags: { "ramon-sg/claude-repo-guard": ["0.4.1"], "ramon-sg/agent-skills": ["0.2.0"] } });
  repo.write(".claude/repo-guard.config.json", {});

  const r = repo.cli(["--yes", "--skip", "issue-flow,agent-cloud-kit,skills"]);

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.calls().some((args) => args.join(" ") === "github:ramon-sg/claude-repo-guard#v0.4.1 install --yes"));
});

test("when the guard fails, its own error is shown, without the sandbox hint", () => {
  const repo = installedRepo({ guard: "0.5.0", tags: { "ramon-sg/claude-repo-guard": ["0.5.0", "0.5.1"], "ramon-sg/agent-skills": ["0.2.0"] } });

  const r = repo.cli(["--yes", "--skip", "issue-flow,agent-cloud-kit,skills"], { env: { FAKE_GUARD_ERROR: "claude-repo-guard: .claude/settings.json no es JSON válido" } });

  assert.equal(r.status, 1);
  assert.match(r.err, /claude-repo-guard no se instaló; su error está abajo\. Para reintentar a mano: 'npx github:ramon-sg\/claude-repo-guard#v0\.5\.1 apply'/);
  assert.match(r.err, /settings\.json no es JSON válido/);
  assert.doesNotMatch(r.err, /sandbox/);
});

test("when the guard cannot write, the hint about Claude's sandbox is added to its error", () => {
  const repo = installedRepo({ guard: "0.5.0", tags: { "ramon-sg/claude-repo-guard": ["0.5.0", "0.5.1"], "ramon-sg/agent-skills": ["0.2.0"] } });

  const r = repo.cli(["--yes", "--skip", "issue-flow,agent-cloud-kit,skills"], { env: { FAKE_GUARD_ERROR: "claude-repo-guard: EPERM: operation not permitted, open '.claude/settings.json'" } });

  assert.equal(r.status, 1);
  assert.match(r.err, /no tuvo permiso para escribir en el repo\. Si corres agent-kitchen dentro de una sesión de Claude, su sandbox bloquea \.claude\/settings\.json; corre 'npx github:ramon-sg\/claude-repo-guard#v0\.5\.1 apply' desde tu terminal/);
  assert.match(r.err, /EPERM: operation not permitted/);
});

// The decisions file as text, to check it was left as it was.
const decisionsText = (repo) => readFileSync(join(repo.main, ".agents/kitchen.json"), "utf8");

// Whether a run called a tool, downloads included.
const called = (repo, prefix) => repo.allCalls().some((args) => args.some((arg) => arg.startsWith(prefix)));

test("a piece set to false is never offered, shown as the repo's decision, and --yes leaves it", () => {
  const repo = makeRepo();
  repo.write(".agents/kitchen.json", { pieces: { "claude-repo-guard": false } });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.ok(!called(repo, "github:ramon-sg/claude-repo-guard"));
  assert.match(r.out, /claude-repo-guard +fuera por decisión del repo/);
  assert.match(r.out, /agent-kitchen apply --pieces/);
});

test("issue-flow set to false acts like --skip issue-flow", () => {
  const repo = makeRepo();
  repo.write(".agents/kitchen.json", { pieces: { "issue-flow": false, "agent-cloud-kit": true, "claude-repo-guard": true, skills: true, "agents-md": true } });

  const general = JSON.stringify(CANDIDATES.filter((candidate) => candidate.catalog === "ramon-sg/agent-skills"));

  const r = repo.cli(["--yes"], { env: { FAKE_CANDIDATES: general } });

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.allCalls().some((args) => args.includes("--candidates") && !args.includes("ramon-sg/issue-flow#v0.2.0")));
  assert.equal(repo.exists(".claude/repo-guard.config.json") ? repo.read(".claude/repo-guard.config.json").environment : undefined, undefined);
  assert.deepEqual(repo.calls().at(-1), ["@ramon-sg/skills-manager@1", "init", "--catalog", "ramon-sg/agent-skills", "--select", "catalog:ramon-sg/agent-skills/planning"]);
});

test("--yes without the file does what it did and writes no file", () => {
  const repo = makeRepo();

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(repo.exists(".agents/kitchen.json"), false);
});

test("--dry-run and --skip leave the file as it was", () => {
  const repo = makeRepo();
  const text = '{ "pieces": { "skills": false }, "other": 1 }\n';
  repo.write(".agents/kitchen.json", text);

  const dry = repo.cli(["--dry-run"]);
  assert.equal(dry.status, 0, dry.err);
  assert.equal(decisionsText(repo), text);

  const skipped = repo.cli(["--yes", "--skip", "agent-cloud-kit"]);
  assert.equal(skipped.status, 0, skipped.err);
  assert.equal(decisionsText(repo), text);
});

test("with the file, a new piece is not installed without a terminal, and says so", () => {
  const repo = makeRepo();
  repo.write(".agents/kitchen.json", { pieces: { "issue-flow": true, "claude-repo-guard": true, skills: true, "agents-md": true } });
  const text = decisionsText(repo);

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.ok(!called(repo, "agent-cloud-kit"));
  assert.match(r.out, /Pieza nueva sin decisión: agent-cloud-kit\. Corre agent-kitchen apply en una terminal/);
  assert.equal(decisionsText(repo), text);
});

test("with the file, an installed piece without a decision is updated with --yes", () => {
  const repo = installedRepo({ guard: "0.1.0" });
  repo.write(".agents/kitchen.json", { pieces: { "issue-flow": true, "agent-cloud-kit": true, skills: true, "agents-md": true } });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.ok(repo.calls().some((args) => args[0] === "github:ramon-sg/claude-repo-guard#v0.2.0"));
});

test("a non-boolean decision warns and counts as no decision", () => {
  const repo = makeRepo();
  repo.write(".agents/kitchen.json", { pieces: { "issue-flow": true, "agent-cloud-kit": "no", "claude-repo-guard": true, skills: true, "agents-md": true } });

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.err, /"agent-cloud-kit" no es true ni false/);
  assert.ok(!called(repo, "agent-cloud-kit"));
});

test("a broken decisions file stops apply and is left as it was", () => {
  const repo = makeRepo();
  repo.write(".agents/kitchen.json", "{");

  const r = repo.cli(["--yes"]);

  assert.equal(r.status, 1);
  assert.match(r.err, /\.agents\/kitchen\.json no es JSON válido/);
  assert.equal(decisionsText(repo), "{");
});

const CLOUD_ONLY = ["--yes", "--skip", "issue-flow,claude-repo-guard,skills"];

test("agent-cloud-kit installs the exact release candidate that npm calls latest", () => {
  const repo = makeRepo();

  const dry = repo.cli(["--dry-run"], { env: { FAKE_NPM: npmCloud("1.0.0-rc.0") } });
  const r = repo.cli(CLOUD_ONLY, { env: { FAKE_NPM: npmCloud("1.0.0-rc.0") } });

  assert.match(dry.out, /Instalar agent-cloud-kit 1\.0\.0-rc\.0: /);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls(), [["agent-cloud-kit@1.0.0-rc.0", "init"]]);
  assert.equal(repo.read(".claude/cloud.json").version, "1.0.0-rc.0");
});

test("agent-cloud-kit falls back to @1 when npm does not answer", () => {
  const repo = makeRepo();

  const r = repo.cli(CLOUD_ONLY, { env: { FAKE_NPM: "{}" } });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls(), [["agent-cloud-kit@1", "init"]]);
});

test("a pinned release candidate moves to the next one, with its $schema", () => {
  const repo = installedRepo({ cloud: "1.0.0-rc.0" });
  repo.write(".claude/cloud.json", { $schema: "https://unpkg.com/agent-cloud-kit@1.0.0-rc.0/schema.json", version: "1.0.0-rc.0", apt: ["jq"] });

  const r = repo.cli(CLOUD_ONLY, { env: { FAKE_NPM: npmCloud("1.0.0-rc.1") } });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.calls(), [["agent-cloud-kit@1.0.0-rc.1", "init"]]);
  assert.deepEqual(repo.read(".claude/cloud.json"), { $schema: "https://unpkg.com/agent-cloud-kit@1.0.0-rc.1/schema.json", version: "1.0.0-rc.1", apt: ["jq"] });
});

test("a pinned release candidate moves to the release, and a release schema to a prerelease", () => {
  const repo = installedRepo({ cloud: "1.0.0-rc.1" });
  repo.write(".claude/cloud.json", { $schema: "https://unpkg.com/agent-cloud-kit@1.0.0-rc.1/schema.json", version: "1.0.0-rc.1" });

  const r = repo.cli(CLOUD_ONLY, { env: { FAKE_NPM: npmCloud("1.0.0") } });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(repo.read(".claude/cloud.json"), { $schema: "https://unpkg.com/agent-cloud-kit@1.0.0/schema.json", version: "1.0.0" });
});

test("a pinned release candidate equal to latest, or newer than it, offers nothing", () => {
  for (const [pinned, latest] of [["1.0.0-rc.0", "1.0.0-rc.0"], ["1.0.0", "1.0.0-rc.1"]]) {
    const repo = installedRepo({ cloud: pinned });

    const r = repo.cli(CLOUD_ONLY, { env: { FAKE_NPM: npmCloud(latest) } });

    assert.equal(r.status, 0, r.err);
    assert.deepEqual(repo.calls().filter((args) => args[0].startsWith("agent-cloud-kit")), [], `${pinned} vs ${latest}`);
    assert.equal(repo.read(".claude/cloud.json").version, pinned);
    const doctor = repo.cli(["doctor"], { env: { FAKE_NPM: npmCloud(latest) } });
    assert.doesNotMatch(doctor.out, /agent-cloud-kit: .*hay/);
    assert.doesNotMatch(doctor.out, /✗ agent-cloud-kit/);
  }
});

test("doctor accepts a pinned release candidate and notes the next one", () => {
  const repo = installedRepo({ cloud: "1.0.0-rc.0" });

  const r = repo.cli(["doctor"], { env: { FAKE_NPM: npmCloud("1.0.0-rc.1") } });

  assert.doesNotMatch(r.out, /no fija una versión exacta/);
  assert.match(r.out, /· agent-cloud-kit: 1\.0\.0-rc\.0, hay 1\.0\.0-rc\.1/);
});
