// Fake npx, bunx and npm for the tests: they log each call (program, arguments, folder) to
// FAKE_LOG and do the little of each tool that agent-kitchen reads back afterwards.
//  - npm view <pkg> version prints FAKE_NPM's entry for <pkg> (a JSON map), or fails; npm
//    view <pkg>@<v> dependencies --json prints FAKE_NPM_DEPS's entry for <pkg>@<v>, or fails.
//  - issue-flow init writes its dev dependencies (keeping the ones the repo has) and
//    .agents/flow.json; upgrade moves its own version; doctor --json prints
//    FAKE_FLOW_DOCTOR (from 0.5.0, a hook's detail in Spanish unless ISSUE_FLOW_LANG is en); labels sync --dry-run prints FAKE_LABELS, and labels sync fails
//    with FAKE_LABELS_FAIL. From 0.3.0, apply, like the real one, pins its own version and
//    adds github-rest only if missing (never skills-manager), makes package.json and
//    .agents/flow.json if missing, and prints its --json with FAKE_FLOW_KEPT as kept; or
//    prints FAKE_FLOW_APPLY_OUT instead, or FAKE_FLOW_APPLY_ERROR on stderr and exits 1.
//    Before 0.3.0 it does not know apply.
//  - agent-cloud-kit init writes .claude/cloud.json at its version.
//  - claude-repo-guard, like the real one, installs with apply from 0.5.0 (and on main) and with
//    install before; the other name fails as the real one does. It writes its manifest at the
//    tag's version, or prints FAKE_GUARD_ERROR on stderr and exits 1; doctor --json prints
//    FAKE_GUARD_DOCTOR.
//  - skills-manager add --candidates prints FAKE_CANDIDATES; init writes a manifest; check
//    fails with FAKE_CHECK_FAIL; update takes one name, like the real one (which ignores the
//    rest), and moves that skill in the lock to its catalog's ref, or to FAKE_UPDATE_TAG.
//  - Like the real ones, issue-flow from 0.5.0 and claude-repo-guard from 0.7.0 refuse to run
//    when their language variable is set to something other than es or en.
//  - github-rest pr create prints a PR's URL. Each call logs GH_REPO too, the language
//    variables of claude-repo-guard and issue-flow (null when unset or empty), and whether the
//    folder had `.agents/runner.json` when it was called.
//  - npm install, pnpm install and bun install write their lockfile, or exit 1 if FAKE_FAIL is "install".
//  - From the first version that reads `.agents/runner.json` (issue-flow 0.6.0, skills-manager
//    1.5.0, claude-repo-guard 0.8.0 on npm, agent-cloud-kit 1.0.0), each one writes its entry
//    there (with the real setTool and writeRunnerConfig of @ramon-sg/runner) instead of
//    devDependencies, cloud.json or the guard's manifest version, as the real ones do:
//    issue-flow apply raises its own, adds github-rest only if missing (at the repo's exact
//    devDependency, else 0.6.0), drops both from devDependencies and writes its three hooks and
//    its shortcuts with the runner's command; `issue-flow --version --json` prints its
//    githubRest (FAKE_FLOW_REST, else 0.6.0). skills-manager raises its own on init, add,
//    install and update when the repo has a manifest. agent-cloud-kit init raises its own
//    (seeded from cloud.json). The guard's apply sets its own (lowering too) in a repo with
//    runner.json, stays in legacy mode in one with its manifest and no runner.json, and makes
//    runner.json on a new install; it writes its manifest and its shortcuts.
// bunx takes a leading `--bun` where npx takes `--yes`, and goes on as npx.
// Any npx call whose arguments contain FAKE_FAIL exits 1, saying so on stderr. A download
// ahead of a step (`npx --package <spec>`) does nothing. Every other npx call prints
// FAKE_SAY, if set, as a tool's own output would be.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { effectiveRunner, readRunnerConfig, setTool, toolCommandText, writeRunnerConfig, writeScripts } from "@ramon-sg/runner";

const program = process.env.FAKE_AS ?? "npx";
const logArgs = process.argv.slice(2);
// `bun --version` prints FAKE_BUN_VERSION (else 1.2.3). `npx --version` and `bunx --version` are how the runner library asks whether a runner works: yes, and unlogged.
if (logArgs.length === 1 && logArgs[0] === "--version") {
  process.stdout.write(program === "bun" ? `${process.env.FAKE_BUN_VERSION ?? "1.2.3"}\n` : "0.0.0\n");
  process.exit(0);
}
appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ program, args: logArgs, cwd: process.cwd(), ghRepo: process.env.GH_REPO ?? null, guardLang: process.env.CLAUDE_REPO_GUARD_LANG || null, flowLang: process.env.ISSUE_FLOW_LANG || null, runnerFile: existsSync(join(process.cwd(), ".agents", "runner.json")) })}\n`);
// From here on bunx is npx: its `--bun` stands where npx's `--yes` does.
const args = program === "bunx" && logArgs[0] === "--bun" ? ["--yes", ...logArgs.slice(1)] : logArgs;

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
// Whether a version is at or above another, both as x.y.z.
const atLeast = (version, since) => version !== null && /^\d+\.\d+\.\d+/.test(version) && version.split(/[.-]/).slice(0, 3).map(Number).reduce((diff, part, index) => diff || part - since[index], 0) >= 0;
// The repo's runner.json, or a new one with Bun.
const runnerFile = (cwd) => readRunnerConfig(cwd) ?? { runner: "bun", tools: {}, extra: {} };
// Writes a tool's entry into runner.json.
const pinTool = (cwd, pkg, version, options) => {
  const { config, changed } = setTool(runnerFile(cwd), pkg, version, options);
  if (changed || !existsSync(join(cwd, ".agents", "runner.json"))) writeRunnerConfig(cwd, config);
  return config;
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
};

if ((program === "npm" || program === "pnpm" || program === "bun") && args[0] === "install") {
  if (process.env.FAKE_FAIL && args.join(" ").includes(process.env.FAKE_FAIL)) {
    process.stderr.write(`fake: ${program} install failed\n`);
    process.exit(1);
  }
  writeFileSync(join(process.cwd(), { npm: "package-lock.json", pnpm: "pnpm-lock.yaml", bun: "bun.lock" }[program]), "lock\n");
  process.exit(0);
}

if (program === "npm") {
  if (args[0] === "view" && args[2] === "dependencies") {
    const deps = JSON.parse(process.env.FAKE_NPM_DEPS ?? "{}")[args[1]];
    if (deps === undefined) {
      process.stderr.write("npm error 404 Not Found\n");
      process.exit(1);
    }
    process.stdout.write(`${JSON.stringify(deps)}\n`);
    process.exit(0);
  }
  const versions = JSON.parse(process.env.FAKE_NPM ?? "{}");
  const version = versions[args[1]];
  if (args[0] !== "view" || version === undefined) {
    process.stderr.write("npm error 404 Not Found\n");
    process.exit(1);
  }
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

const [, spec, command, ...rest] = args;
if (spec === "--package") process.exit(0);
if (process.env.FAKE_FAIL && args.join(" ").includes(process.env.FAKE_FAIL)) {
  process.stderr.write(`fake: ${process.env.FAKE_FAIL} failed\n`);
  process.exit(1);
}
if (process.env.FAKE_SAY && !rest.includes("--candidates") && !rest.includes("--json")) process.stderr.write(`${process.env.FAKE_SAY}\n`);
const cwd = process.cwd();

// The language variable a tool reads at its version, if it reads one.
const langVar = (() => {
  const at = (version, since) => version !== null && version.split(".").map(Number).reduce((diff, part, index) => diff || part - since[index], 0) >= 0;
  if (spec.startsWith("@ramon-sg/issue-flow@") && at(spec.split("@").at(-1), [0, 5, 0])) return "ISSUE_FLOW_LANG";
  if (spec.startsWith("github:ramon-sg/claude-repo-guard") && at(spec.includes("#v") ? spec.split("#v")[1] : "9.9.9", [0, 7, 0])) return "CLAUDE_REPO_GUARD_LANG";
  if (spec.startsWith("@ramon-sg/claude-repo-guard@")) return "CLAUDE_REPO_GUARD_LANG";
  return null;
})();
if (langVar !== null && process.env[langVar] && !["es", "en"].includes(process.env[langVar])) {
  process.stderr.write(`${langVar} expects es or en: ${process.env[langVar]}\n`);
  process.exit(2);
}

if (spec.startsWith("@ramon-sg/issue-flow@")) {
  const version = spec.split("@").at(-1);
  const pkgFile = join(cwd, "package.json");
  const pkg = readJson(pkgFile) ?? {};
  const [major, minor] = version.split(".").map(Number);
  const applies = major > 0 || minor >= 3;
  if (command === "apply" && !applies) {
    process.stderr.write('issue-flow: unknown command "apply"\n');
    process.exit(2);
  }
  const runnerAware = atLeast(version, [0, 6, 0]);
  if (command === "--version" && runnerAware) process.stdout.write(`${JSON.stringify({ version, githubRest: process.env.FAKE_FLOW_REST ?? "0.6.0", runner: "1.0.0" })}\n`);
  if (command === "apply" && runnerAware) {
    if (process.env.FAKE_FLOW_APPLY_ERROR) {
      process.stderr.write(`${process.env.FAKE_FLOW_APPLY_ERROR}\n`);
      process.exit(1);
    }
    const legacyRest = pkg.devDependencies?.["@ramon-sg/github-rest"];
    pinTool(cwd, "@ramon-sg/issue-flow", version);
    const config = pinTool(cwd, "@ramon-sg/github-rest", /^\d+\.\d+\.\d+$/.test(legacyRest ?? "") ? legacyRest : "0.6.0", { ifMissing: true });
    const runner = effectiveRunner(config);
    const run = (args) => toolCommandText(runner, "@ramon-sg/issue-flow", version, args);
    if (existsSync(pkgFile)) {
      const next = readJson(pkgFile);
      for (const field of ["dependencies", "devDependencies"]) {
        if (next[field] === undefined) continue;
        delete next[field]["@ramon-sg/issue-flow"];
        delete next[field]["@ramon-sg/github-rest"];
        if (Object.keys(next[field]).length === 0) delete next[field];
      }
      writeJson(pkgFile, next);
    }
    writeScripts(cwd, runner, { "issue:start": run(["issue", "start"]), "worktree:prune": run(["worktree", "prune"]), "pr:worktree": run(["pr", "worktree"]) }, "@ramon-sg/issue-flow@");
    const settingsFile = join(cwd, ".claude", "settings.json");
    const settings = readJson(settingsFile) ?? {};
    const hook = (args) => [{ hooks: [{ type: "command", command: run(args), timeout: 600 }] }];
    const others = (event) => (settings.hooks?.[event] ?? []).filter((group) => !JSON.stringify(group).includes("@ramon-sg/issue-flow@"));
    settings.hooks = { ...settings.hooks, SessionStart: [...others("SessionStart"), ...hook(["session"])], WorktreeCreate: [...others("WorktreeCreate"), ...hook(["hook", "worktree-create"])], WorktreeRemove: [...others("WorktreeRemove"), ...hook(["hook", "worktree-remove"])] };
    writeJson(settingsFile, settings);
    if (!existsSync(join(cwd, ".agents", "flow.json"))) writeJson(join(cwd, ".agents", "flow.json"), {});
    const kept = process.env.FAKE_FLOW_KEPT ? [process.env.FAKE_FLOW_KEPT] : [];
    process.stdout.write(process.env.FAKE_FLOW_APPLY_OUT ?? `${JSON.stringify({ version, changes: [`.agents/runner.json: @ramon-sg/issue-flow ${version}`], kept, written: true, next: [] })}\n`);
  } else if (command === "apply") {
    if (process.env.FAKE_FLOW_APPLY_ERROR) {
      process.stderr.write(`${process.env.FAKE_FLOW_APPLY_ERROR}\n`);
      process.exit(1);
    }
    const next = readJson(pkgFile) ?? { private: true };
    next.devDependencies = { ...next.devDependencies, "@ramon-sg/issue-flow": version };
    if (next.devDependencies["@ramon-sg/github-rest"] === undefined) next.devDependencies["@ramon-sg/github-rest"] = "0.3.0";
    writeJson(pkgFile, next);
    if (!existsSync(join(cwd, ".agents", "flow.json"))) writeJson(join(cwd, ".agents", "flow.json"), {});
    const kept = process.env.FAKE_FLOW_KEPT ? [process.env.FAKE_FLOW_KEPT] : [];
    process.stdout.write(process.env.FAKE_FLOW_APPLY_OUT ?? `${JSON.stringify({ version, changes: [`package.json: devDependencies: @ramon-sg/issue-flow ${version}`], kept, written: true, next: ["npm install"] })}\n`);
  }
  if (command === "init") {
    // Like the real one, it keeps the versions the repo already has of its companions.
    pkg.devDependencies = { "@ramon-sg/github-rest": "0.2.1", "@ramon-sg/skills-manager": "1.2.0", ...pkg.devDependencies, "@ramon-sg/issue-flow": version };
    writeJson(pkgFile, pkg);
    if (!existsSync(join(cwd, ".agents", "flow.json"))) writeJson(join(cwd, ".agents", "flow.json"), {});
  }
  if (command === "upgrade") {
    pkg.devDependencies = { ...pkg.devDependencies, "@ramon-sg/issue-flow": version };
    writeJson(pkgFile, pkg);
  }
  if (command === "doctor") {
    const said = process.env.FAKE_FLOW_DOCTOR ?? '[{"name":".agents/flow.json","ok":true,"detail":"valid"}]';
    // Like the real one, from 0.5.0 it speaks Spanish unless ISSUE_FLOW_LANG says en.
    const spanish = (major > 0 || minor >= 5) && process.env.ISSUE_FLOW_LANG !== "en";
    process.stdout.write(spanish ? said.replace(/"at (\d+\.\d+\.\d+), this is /g, '"en $1, esta es ') : said);
  }
  if (command === "labels" && rest.includes("--dry-run")) process.stdout.write(process.env.FAKE_LABELS ?? '{"labels":[]}');
  else if (command === "labels" && process.env.FAKE_LABELS_FAIL) {
    process.stderr.write("fake: gh auth login is needed\n");
    process.exit(1);
  }
} else if (spec.startsWith("@ramon-sg/github-rest@") && command === "pr" && rest[0] === "create") {
  process.stdout.write("https://github.com/o/r/pull/7\n");
} else if (spec.startsWith("agent-cloud-kit@") && command === "init" && atLeast(spec.split("@").at(-1), [1, 0, 0]) && !spec.split("@").at(-1).includes("-")) {
  const version = spec.split("@").at(-1);
  const cloudFile = join(cwd, ".claude", "cloud.json");
  const seed = readJson(cloudFile)?.version;
  // Like the real one: a new runner.json starts at cloud.json's version, and then rises to this one.
  if (!existsSync(join(cwd, ".agents", "runner.json")) && typeof seed === "string" && /^\d+\.\d+\.\d+/.test(seed)) pinTool(cwd, "agent-cloud-kit", seed);
  pinTool(cwd, "agent-cloud-kit", version);
  if (!existsSync(cloudFile)) writeJson(cloudFile, {});
} else if (spec.startsWith("agent-cloud-kit@") && command === "init") {
  const version = spec.split("@").at(-1);
  // Idempotent like the real one: it does not overwrite an existing config.
  if (!existsSync(join(cwd, ".claude", "cloud.json"))) writeJson(join(cwd, ".claude", "cloud.json"), { version: version === "1" ? "1.0.0" : version });
} else if (spec.startsWith("github:ramon-sg/claude-repo-guard")) {
  const version = spec.includes("#v") ? spec.split("#v")[1] : null;
  const [major, minor] = (version ?? "9.9.9").split(".").map(Number);
  const applies = major > 0 || minor >= 5;
  if (command === "install" && applies) {
    process.stderr.write('claude-repo-guard: "install" ahora se llama "apply". Hace lo mismo: instala, actualiza o aplica cambios.\n');
    process.exit(1);
  }
  if (command === "apply" && !applies) {
    process.stderr.write('claude-repo-guard: no conozco el comando "apply".\n');
    process.exit(1);
  }
  if (command === "install" || command === "apply") {
    if (process.env.FAKE_GUARD_ERROR) {
      process.stderr.write(`${process.env.FAKE_GUARD_ERROR}\n`);
      process.exit(1);
    }
    writeJson(join(cwd, ".claude", "repo-guard.manifest.json"), { version: version ?? "0.0.0" });
  }
  if (command === "doctor") process.stdout.write(process.env.FAKE_GUARD_DOCTOR ?? "[]");
} else if (spec.startsWith("@ramon-sg/claude-repo-guard@")) {
  const version = spec.split("@").at(-1);
  if (command === "apply") {
    if (process.env.FAKE_GUARD_ERROR) {
      process.stderr.write(`${process.env.FAKE_GUARD_ERROR}\n`);
      process.exit(1);
    }
    const manifest = join(cwd, ".claude", "repo-guard.manifest.json");
    const legacy = existsSync(manifest) && !existsSync(join(cwd, ".agents", "runner.json"));
    if (!legacy) {
      const config = pinTool(cwd, "@ramon-sg/claude-repo-guard", version, { allowLower: true });
      writeScripts(cwd, effectiveRunner(config), { "claude:auto": "claude --settings .claude/repo-guard.auto-mode.json --permission-mode auto" }, "repo-guard");
    }
    writeJson(manifest, { version });
  }
  if (command === "doctor") process.stdout.write(process.env.FAKE_GUARD_DOCTOR ?? "[]");
} else if (spec.startsWith("@ramon-sg/skills-manager@")) {
  const version = spec.split("@").at(-1);
  const writes = ["init", "add", "install", "update"].includes(command) && !rest.includes("--candidates") && !rest.includes("--dry-run");
  // Like the real one from 1.5.0: once it worked, it raises its own entry, if the repo has a manifest.
  process.on("exit", (code) => {
    if (code === 0 && writes && atLeast(version, [1, 5, 0]) && existsSync(join(cwd, ".agents", "skills.json"))) pinTool(cwd, "@ramon-sg/skills-manager", version);
  });
  if (rest.includes("--candidates")) process.stdout.write(process.env.FAKE_CANDIDATES ?? "[]");
  else if (command === "init") writeJson(join(cwd, ".agents", "skills.json"), { sources: [] });
  else if (command === "check" && process.env.FAKE_CHECK_FAIL) process.exit(1);
  else if (command === "update") {
    if (rest.length !== 1) {
      process.stderr.write("fake skills-manager: update takes one name\n");
      process.exit(2);
    }
    const manifest = readJson(join(cwd, ".agents", "skills.json"));
    const lockFile = join(cwd, manifest?.paths?.lock ?? ".agents/skills.lock.json");
    const lock = readJson(lockFile);
    const entry = lock.skills[rest[0]];
    const source = manifest.sources.find((item) => entry.source === `catalog:${item.catalog}`);
    entry.tag = source?.ref ?? process.env.FAKE_UPDATE_TAG ?? "v0.2.0";
    writeJson(lockFile, lock);
  }
}
