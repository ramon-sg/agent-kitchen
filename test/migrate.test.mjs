// Moving a legacy repo (its tools in dependencies or devDependencies, `.claude/cloud.json` and the
// guard's manifest, no `.agents/runner.json`) to runner.json: one step, `runner`, offered only when
// the latest version of every installed tool already reads runner.json, and never with a tool the
// run leaves out. It writes runner.json first (runner and github-rest only), then runs each tool at
// its latest in a fixed order (issue-flow, claude-repo-guard, agent-cloud-kit, skills-manager),
// each one pinned only once it worked, and cleans up what the tools leave: the tools it pinned in
// dependencies and devDependencies, the scripts that were only skills-manager, the `version` of
// cloud.json, and node_modules and the lockfile when the repo has no dependencies of its own (with
// some, the install of its manager runs instead). A move cut short is finished by a later run: the
// failed tools come back as their pieces' steps, and the `runner` piece offers to finish the
// cleanup, taking out only what that run can, and in runner mode only from devDependencies and
// never a lockfile alone, nor one while package.json keeps any dependency entry.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { installedRepo, RULE } from "./helpers.mjs";

// Every tool at (or past) its first version that reads runner.json, and github-rest 0.7.0.
const LATEST = {
  "@ramon-sg/issue-flow": "0.6.0",
  "@ramon-sg/github-rest": "0.7.0",
  "@ramon-sg/skills-manager": "1.5.1",
  "@ramon-sg/claude-repo-guard": "0.8.0",
  "agent-cloud-kit": "1.0.0",
};

// The guard's tags on GitHub: the repo is at the newest below v0.8.0, so legacy mode offers nothing for it.
const TAGS = { "ramon-sg/claude-repo-guard": ["0.7.0"], "ramon-sg/agent-skills": ["0.2.0"] };

// A legacy repo with every tool, at versions below their minimums, with what a legacy install leaves:
// a lockfile, node_modules, and a script that runs skills-manager from them.
function legacyRepo({ lock = "package-lock.json", dependencies, origin = false } = {}) {
  const repo = installedRepo({ flow: "0.5.1", cloud: "0.9.1", guard: "0.7.0", tags: TAGS, origin });
  repo.write("package.json", {
    scripts: { skills: "npx skills-manager update", both: "skills-manager check && node --test", test: "node --test" },
    ...(dependencies === undefined ? {} : { dependencies }),
    devDependencies: { "@ramon-sg/issue-flow": "0.5.1", "@ramon-sg/github-rest": "0.2.1", "@ramon-sg/skills-manager": "1.2.0" },
  });
  repo.write(lock, "lock\n");
  repo.write("node_modules/@ramon-sg/skills-manager/package.json", { version: "1.2.0" });
  return repo;
}

const env = (latest = LATEST) => ({ env: { FAKE_NPM: JSON.stringify(latest) } });

// The tool calls of the last run, as text, with whether runner.json existed when each one ran.
const toolLog = (repo) => repo.log().filter((call) => ["npx", "bunx"].includes(call.program) && call.args[1] !== "--package").map((call) => ({ program: call.program, text: call.args.slice(1).join(" "), runnerFile: call.runnerFile }));

test("a legacy repo whose tools all have a release that reads runner.json is offered the move, and --dry-run writes nothing", () => {
  const repo = legacyRepo();

  const r = repo.cli(["apply", "--dry-run"], env());

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /\n {2}runner +/);
  assert.match(r.out, /\[x\] Pasar las herramientas a \.agents\/runner\.json con el ejecutor bun: issue-flow 0\.6\.0, claude-repo-guard 0\.8\.0, agent-cloud-kit 1\.0\.0, skills-manager 1\.5\.1/);
  // While the move is offered, no tool gets a legacy step of its own.
  assert.doesNotMatch(r.out, /\[.\] (Actualizar|Instalar|Reparar|Subir|Agregar|Fijar) (issue-flow|claude-repo-guard|agent-cloud-kit|skills-manager|github-rest)/);
  assert.equal(repo.exists(".agents/runner.json"), false);
  assert.ok(repo.exists("package-lock.json"));
  assert.equal(repo.read(".claude/cloud.json").version, "0.9.1");
});

test("apply --yes moves a legacy repo to runner.json: five versions there, no ecosystem devDependencies, no cloud.json version, no lockfile or node_modules", () => {
  const repo = legacyRepo();

  const r = repo.cli(["apply", "--yes"], env());

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.deepEqual(repo.read(".agents/runner.json").tools, LATEST);
  assert.equal(repo.read(".agents/runner.json").runner, "bun");
  const pkg = repo.read("package.json");
  assert.equal(pkg.devDependencies, undefined, JSON.stringify(pkg));
  assert.equal(pkg.scripts.skills, undefined, "the script that ran skills-manager from node_modules is gone");
  assert.equal(pkg.scripts.test, "node --test", "the repo's own scripts stay");
  assert.equal(pkg.scripts.both, "skills-manager check && node --test", "a script that also runs other commands stays");
  assert.match(r.out, /scripts\.both corre skills-manager sin versión junto con otros comandos/);
  assert.ok(repo.exists(".claude/cloud.json"));
  assert.equal("version" in repo.read(".claude/cloud.json"), false);
  assert.ok(repo.exists(".claude/repo-guard.manifest.json"), "the guard's manifest stays: its uninstall reads it");
  assert.equal(repo.exists("package-lock.json"), false);
  assert.equal(repo.exists("node_modules"), false);
  assert.deepEqual(repo.npmCalls().filter((args) => args[0] === "install"), []);
  const hooks = repo.read(".claude/settings.json").hooks.SessionStart.flatMap((group) => group.hooks.map((hook) => hook.command));
  assert.ok(hooks.includes("bunx --bun @ramon-sg/skills-manager@1.5.1 session-notice"), hooks.join("\n"));
  assert.match(r.out, /\.agents\/runner\.json/);
});

test("with dependencies of its own and a pnpm lockfile, the move runs pnpm install and keeps them and the lockfile", () => {
  const repo = legacyRepo({ lock: "pnpm-lock.yaml", dependencies: { react: "19.0.0" } });

  const r = repo.cli(["apply", "--yes"], env());

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.deepEqual(repo.read("package.json").dependencies, { react: "19.0.0" });
  assert.equal(repo.read("package.json").devDependencies, undefined);
  assert.ok(repo.exists("pnpm-lock.yaml"));
  assert.equal(repo.log().filter((call) => call.program === "pnpm" && call.args[0] === "install").length, 1);
  assert.deepEqual(repo.read(".agents/runner.json").tools, LATEST);
});

test("with no skills-manager on npm at or above 1.5.0 there is no move: the table names it and its minimum, and nothing changes", () => {
  const repo = legacyRepo();
  const files = ["package.json", ".claude/cloud.json", ".claude/repo-guard.manifest.json", "package-lock.json"];
  const before = files.map((file) => readFileSync(join(repo.main, file), "utf8"));

  const r = repo.cli(["apply", "--yes"], env({ ...LATEST, "@ramon-sg/skills-manager": "1.4.0" }));

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.doesNotMatch(r.out, /Pasar las herramientas/);
  assert.match(r.out, /\n {2}runner +[^\n]*@ramon-sg\/skills-manager 1\.5\.0/);
  assert.equal(repo.exists(".agents/runner.json"), false);
  assert.deepEqual(files.map((file) => readFileSync(join(repo.main, file), "utf8")), before);
  assert.ok(repo.exists("node_modules"));
  assert.ok(toolLog(repo).every((call) => call.program === "npx" && !call.runnerFile), JSON.stringify(toolLog(repo)));
});

test("a tool left out of the run (--skip, or false in kitchen.json) holds the move back: the table says so, and nothing moves", () => {
  const skipped = legacyRepo();
  const decided = legacyRepo();
  decided.write(".agents/kitchen.json", { pieces: { "claude-repo-guard": false } });

  const a = skipped.cli(["apply", "--yes", "--skip", "claude-repo-guard"], env());
  const b = decided.cli(["apply", "--yes"], env());

  for (const [repo, r] of [[skipped, a], [decided, b]]) {
    assert.equal(r.status, 0, `${r.out}\n${r.err}`);
    assert.doesNotMatch(r.out, /Pasar las herramientas/);
    assert.match(r.out, /\n {2}runner +[^\n]*deja fuera claude-repo-guard/);
    assert.equal(repo.exists(".agents/runner.json"), false);
    assert.ok(toolLog(repo).every((call) => call.program === "npx"), JSON.stringify(toolLog(repo)));
  }
});

test("the move writes runner.json before any tool runs, then runs issue-flow, the guard, agent-cloud-kit and skills-manager, in that order, with bunx", () => {
  const repo = legacyRepo();

  const r = repo.cli(["apply", "--yes"], env());

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  const calls = toolLog(repo);
  const first = calls.findIndex((call) => call.runnerFile);
  assert.ok(first >= 0, JSON.stringify(calls));
  assert.ok(calls.slice(first).every((call) => call.runnerFile && call.program === "bunx"), JSON.stringify(calls));
  assert.equal(calls[first].text, "@ramon-sg/issue-flow@0.6.0 apply --yes --json");
  const order = ["@ramon-sg/issue-flow@0.6.0 apply --yes --json", "@ramon-sg/claude-repo-guard@0.8.0 apply --yes", "agent-cloud-kit@1.0.0 init", "@ramon-sg/skills-manager@1.5.1 install"].map((text) => calls.findIndex((call) => call.text === text));
  assert.ok(order.every((index) => index >= first), `${order} in ${JSON.stringify(calls)}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(repo.allCalls().every((args) => !args[0].startsWith("github:ramon-sg/claude-repo-guard") || !args.includes("apply")), "the guard no longer runs from GitHub");
  // The flow's skills follow it to its new tag.
  assert.equal(repo.read(".agents/skills.lock.json").skills["close-pr"].tag, "v0.6.0");
  assert.ok(repo.exists(".claude/cloud.json"));
  assert.equal("version" in repo.read(".claude/cloud.json"), false);
  assert.ok(repo.exists(".claude/repo-guard.manifest.json"));
});

test("a tool that fails stops the move: the next ones do not run, and the output says which failed and which did not run", () => {
  const repo = legacyRepo();

  const r = repo.cli(["apply", "--yes"], { env: { FAKE_NPM: JSON.stringify(LATEST), FAKE_FAIL: "claude-repo-guard@0.8.0 apply" } });

  assert.equal(r.status, 1, r.out);
  const calls = toolLog(repo).map((call) => call.text);
  assert.ok(calls.includes("@ramon-sg/issue-flow@0.6.0 apply --yes --json"), calls.join("\n"));
  assert.ok(!calls.some((call) => call.startsWith("agent-cloud-kit@1.0.0 init") || call.startsWith("@ramon-sg/skills-manager@1.5.1 install")), calls.join("\n"));
  assert.match(r.err, /claude-repo-guard no se instaló/);
  assert.match(r.out, /No corrieron: agent-cloud-kit, skills-manager/);
  assert.match(r.out, /fallaron: Pasar las herramientas a \.agents\/runner\.json/);
  // Nothing is undone, and the cleanup did not run either.
  assert.ok(repo.exists(".agents/runner.json"));
  assert.ok(repo.exists("package-lock.json"));
  assert.equal(repo.read(".claude/cloud.json").version, "0.9.1");
});

// What a finished move leaves, as the test of a successful one checks it.
function assertMoved(repo) {
  assert.deepEqual(repo.read(".agents/runner.json").tools, LATEST);
  assert.equal(repo.read("package.json").devDependencies, undefined);
  assert.equal("version" in repo.read(".claude/cloud.json"), false);
  assert.equal(repo.exists("package-lock.json"), false);
  assert.equal(repo.exists("node_modules"), false);
  const hooks = repo.read(".claude/settings.json").hooks.SessionStart.flatMap((group) => group.hooks.map((hook) => hook.command));
  assert.ok(hooks.includes("bunx --bun @ramon-sg/skills-manager@1.5.1 session-notice"), hooks.join("\n"));
}

test("a move cut short by a failure is finished by the next apply: the failed tools run again, then the cleanup", () => {
  const repo = legacyRepo();
  const first = repo.cli(["apply", "--yes"], { env: { FAKE_NPM: JSON.stringify(LATEST), FAKE_FAIL: "claude-repo-guard@0.8.0 apply" } });
  assert.equal(first.status, 1, first.out);
  const pins = repo.read(".agents/runner.json").tools;
  assert.equal(pins["@ramon-sg/claude-repo-guard"], undefined, "a tool whose part failed has no entry");
  assert.equal(pins["agent-cloud-kit"], undefined);
  assert.equal(pins["@ramon-sg/issue-flow"], "0.6.0");

  const dry = repo.cli(["apply", "--dry-run"], env());
  assert.match(dry.out, /\[x\] Terminar el paso a \.agents\/runner\.json: quitar @ramon-sg\/skills-manager, scripts\.skills en package\.json, "version" en \.claude\/cloud\.json, package-lock\.json, node_modules/);
  const second = repo.cli(["apply", "--yes"], env());

  assert.equal(second.status, 0, `${second.out}\n${second.err}`);
  const calls = toolLog(repo).map((call) => call.text);
  for (const call of ["@ramon-sg/claude-repo-guard@0.8.0 apply --yes", "agent-cloud-kit@1.0.0 init", "@ramon-sg/skills-manager@1.5.1 install"]) assert.ok(calls.includes(call), `${call} in ${calls.join("\n")}`);
  assertMoved(repo);
  assert.equal(repo.read(".agents/skills.lock.json").skills["close-pr"].tag, "v0.6.0");
  const third = repo.cli(["apply", "--dry-run"], env());
  assert.doesNotMatch(third.out, /Terminar el paso/);
});

test("the move never lowers github-rest: a newer exact one in package.json is kept", () => {
  const repo = legacyRepo();
  const pkg = repo.read("package.json");
  pkg.devDependencies["@ramon-sg/github-rest"] = "0.8.2";
  repo.write("package.json", pkg);

  const r = repo.cli(["apply", "--yes"], env());

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.equal(repo.read(".agents/runner.json").tools["@ramon-sg/github-rest"], "0.8.2");
});

test("the rule about node_modules planned before the move is not written into a repo the move left without dependencies", () => {
  const repo = legacyRepo();
  repo.write("AGENTS.md", "# Repo\n");

  const r = repo.cli(["apply", "--yes"], env());

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.ok(!readFileSync(join(repo.main, "AGENTS.md"), "utf8").includes(RULE));
  assert.match(r.out, /la regla no se agregó/);
});

// A repo in runner mode after a move, with the tools pinned, the guard's manifest, and package.json as given.
function movedRepo(pkg, tools = LATEST) {
  const repo = installedRepo({ flow: "0.6.0", guard: "0.8.0", tags: TAGS });
  repo.write("package.json", pkg);
  repo.write(".claude/cloud.json", {});
  repo.write(".agents/runner.json", { runner: "bun", tools });
  repo.write(".agents/skills.lock.json", { lockVersion: 2, skills: {} });
  return repo;
}

test("finishing a move takes out only what this run can: a left-out tool's leftovers are not claimed, nor offered again", () => {
  const { "agent-cloud-kit": _cloud, ...tools } = LATEST;
  const repo = movedRepo({ private: true }, tools);
  repo.write(".claude/cloud.json", { version: "0.9.1" });

  const r = repo.cli(["apply", "--yes", "--skip", "agent-cloud-kit"], env());
  const again = repo.cli(["apply", "--dry-run", "--skip", "agent-cloud-kit"], env());

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.doesNotMatch(r.out, /"version" en \.claude\/cloud\.json/);
  assert.equal(repo.read(".claude/cloud.json").version, "0.9.1");
  assert.doesNotMatch(again.out, /Terminar el paso/);
});

test("finishing a move says what it took out when a tool it waited for failed in the same run", () => {
  const { "agent-cloud-kit": _cloud, ...tools } = LATEST;
  const repo = movedRepo({ private: true, devDependencies: { "@ramon-sg/skills-manager": "1.2.0" } }, tools);
  repo.write(".claude/cloud.json", { version: "0.9.1" });

  const r = repo.cli(["apply", "--yes"], { env: { FAKE_NPM: JSON.stringify(LATEST), FAKE_FAIL: "agent-cloud-kit@1.0.0 init" } });

  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /Paso a \.agents\/runner\.json terminado: sin @ramon-sg\/skills-manager en package\.json\b/);
  assert.doesNotMatch(r.out, /terminado: [^\n]*"version" en \.claude\/cloud\.json/);
  assert.equal(repo.read(".claude/cloud.json").version, "0.9.1");
  assert.equal(repo.read("package.json").devDependencies, undefined);
});

test("in runner mode a lockfile and node_modules the repo uses are never offered: workspaces, or nothing legacy to take out", () => {
  const workspaces = movedRepo({ private: true, workspaces: ["packages/*"], devDependencies: { "@ramon-sg/skills-manager": "1.2.0" } });
  workspaces.write("packages/a/package.json", { name: "a", dependencies: { react: "19.0.0" } });
  const alone = movedRepo({ private: true });
  for (const repo of [workspaces, alone]) {
    repo.write("package-lock.json", "lock\n");
    repo.write("node_modules/react/package.json", { version: "19.0.0" });
  }

  const a = workspaces.cli(["apply", "--dry-run"], env());
  const b = alone.cli(["apply", "--dry-run"], env());

  assert.match(a.out, /\[x\] Terminar el paso a \.agents\/runner\.json: quitar @ramon-sg\/skills-manager en package\.json\n/);
  assert.doesNotMatch(a.out, /package-lock\.json|node_modules/);
  assert.doesNotMatch(b.out, /Terminar el paso/);
});

test("finishing a move outside it leaves an ecosystem tool in dependencies: it is the repo's own use", () => {
  const repo = movedRepo({ private: true, dependencies: { "@ramon-sg/github-rest": "0.7.0" }, devDependencies: { "@ramon-sg/skills-manager": "1.2.0" } });
  repo.write("package-lock.json", "lock\n");
  repo.write("node_modules/@ramon-sg/github-rest/package.json", { version: "0.7.0" });

  const r = repo.cli(["apply", "--yes"], env());

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  assert.deepEqual(repo.read("package.json").dependencies, { "@ramon-sg/github-rest": "0.7.0" });
  assert.equal(repo.read("package.json").devDependencies, undefined);
  // package.json still has a dependency, so its lockfile stays, and the install runs since package.json changed.
  assert.ok(repo.exists("package-lock.json"));
  assert.ok(repo.exists("node_modules"));
  assert.equal(repo.npmCalls().filter((args) => args[0] === "install").length, 1);
});

test("the move takes the tools out of dependencies too, and then the lockfile and node_modules, with no install", () => {
  const repo = legacyRepo();
  const pkg = repo.read("package.json");
  repo.write("package.json", { scripts: pkg.scripts, dependencies: pkg.devDependencies });

  const r = repo.cli(["apply", "--yes"], env());

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  const after = repo.read("package.json");
  assert.equal(after.dependencies, undefined, JSON.stringify(after));
  assert.equal(after.devDependencies, undefined, JSON.stringify(after));
  assert.deepEqual(repo.read(".agents/runner.json").tools, LATEST);
  assert.equal(repo.exists("package-lock.json"), false);
  assert.equal(repo.exists("node_modules"), false);
  assert.deepEqual(repo.npmCalls().filter((args) => args[0] === "install"), []);
});

test("--pr commits runner.json, package.json and the deleted lockfile", () => {
  const repo = legacyRepo({ origin: true });
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "tools");
  repo.git("push", "-q", "origin", "main");

  const r = repo.cli(["apply", "--yes", "--pr"], env());

  assert.equal(r.status, 0, `${r.out}\n${r.err}`);
  const branch = repo.git("ls-remote", "--heads", "origin").split("\n").map((line) => line.split("refs/heads/")[1]).find((name) => name !== "main");
  const files = repo.git("show", "--name-only", "--format=", `origin/${branch}`).split("\n");
  for (const file of [".agents/runner.json", "package.json", "package-lock.json", ".claude/cloud.json"]) assert.ok(files.includes(file), `${file} in ${files.join(", ")}`);
  assert.match(repo.git("show", "--name-status", "--format=", `origin/${branch}`), /D\tpackage-lock\.json/);
  assert.match(repo.git("log", "-1", "--format=%B", `origin/${branch}`), /- Pasar las herramientas a \.agents\/runner\.json con el ejecutor bun/);
  assert.equal(repo.exists(".agents/runner.json"), false, "the checkout is left as it was");
});
