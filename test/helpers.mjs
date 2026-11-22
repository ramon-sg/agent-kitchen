// Helpers of the tests: a repo with a main checkout (and, if asked, a local origin), the fake
// npx, bun, npm and pnpm of fake-tools.mjs
// first in PATH, local GitHub repos with release tags (git reaches them through an
// insteadOf rewrite of https://github.com/, so `git ls-remote` is the real one), and the
// compiled CLI.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "dist", "cli.js");
const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

// The fake npm registry (fake-registry.mjs), started once per test file. It dies with the test
// process: its stdin closes, and it is not waited for.
const registry = spawn(process.execPath, [join(HERE, "fake-registry.mjs"), realpathSync(tmpdir())], { stdio: ["pipe", "pipe", "inherit"] });
const PORT = await new Promise((resolve, reject) => {
  registry.once("error", reject);
  registry.stdout.once("data", (chunk) => resolve(String(chunk).trim()));
});
registry.unref();
registry.stdin.unref();
registry.stdout.unref();

// The latest of everything on npm, unless a test says otherwise.
export { GIT_ENV };

// agent-cloud-kit stays below 1.0.0, its first version that reads runner.json, so a legacy repo
// may go to it.
export const NPM = { "@ramon-sg/issue-flow": "0.2.0", "agent-cloud-kit": "0.9.1" };

// What npm answers when agent-cloud-kit's `latest` is `version` (a release candidate, say) and
// everything else is as in NPM. For FAKE_NPM.
export const npmCloud = (version) => JSON.stringify({ ...NPM, "agent-cloud-kit": version });

// The rule agent-kitchen writes into AGENTS.md (src/pieces/agents-md.ts), copied as a literal on
// purpose: the line is a contract that other agents read, not a value to derive.
export const RULE = "Antes de usar una biblioteca, mira su versión instalada en `node_modules/<biblioteca>/package.json` y lee sus tipos o su documentación ahí. Si no alcanza, busca la documentación de esa versión, no la última.";

// What the catalogs offer (skills-manager --candidates), unless a test says otherwise.
export const CANDIDATES = [
  { id: "catalog:ramon-sg/issue-flow/github-issues", name: "github-issues", catalog: "ramon-sg/issue-flow", description: "Crea issues cortas", skills: ["github-issues"], requires: [] },
  { id: "catalog:ramon-sg/issue-flow/close-pr", name: "close-pr", catalog: "ramon-sg/issue-flow", description: "Cierra un PR", skills: ["close-pr"], requires: ["pr-review-comments"] },
  { id: "catalog:ramon-sg/issue-flow/pr-review-comments", name: "pr-review-comments", catalog: "ramon-sg/issue-flow", description: "Resuelve comentarios", skills: ["pr-review-comments"], requires: [] },
  { id: "catalog:ramon-sg/agent-skills/planning", name: "planning", catalog: "ramon-sg/agent-skills", description: "Planes cortos", skills: ["planning"], requires: [] },
];

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } }).trim();

// The calls of one program logged in a file.
const logged = (log, program) => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((call) => call.program === program).map((call) => call.args) : []);

// The tools' runners.
const RUNNERS = ["npx", "bun x"];

// The npx and `bun x` calls logged in a file, in order, with their program and their arguments
// without the first one (`--yes` or `--bun`).
const toolCalls = (log) => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((call) => RUNNERS.includes(call.program)).map((call) => ({ program: call.program, args: call.args.slice(1) })) : []);

// The npx and `bun x` calls logged in a file, without `--yes` or `--bun`.
const npxCalls = (log) => toolCalls(log).map((call) => call.args);

// A repo for the tests. `tags` gives the release tags of each GitHub repo.
// With `origin`, the repo also gets an `origin` remote (a local bare repo) with main pushed
// and `origin/HEAD` set, as a clone has.
// By default the repo already has agent-cloud-kit at its latest in .claude/cloud.json (committed, so a
// clone of origin has it too; it asks for no step): it is not new, so apply leaves it in legacy mode
// and the legacy tests keep their ground. A new repo, which apply starts in runner mode, is `makeFreshRepo`.
export function makeRepo({ tags = { "ramon-sg/claude-repo-guard": ["0.1.0", "0.2.0"], "ramon-sg/agent-skills": ["0.1.0", "0.2.0"] }, origin = false, fresh = false } = {}) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "agent-kitchen-")));
  const main = join(tmp, "main");
  const bin = join(tmp, "bin");
  mkdirSync(main);
  mkdirSync(bin);
  git(main, "init", "-q", "-b", "main");
  if (!fresh) {
    mkdirSync(join(main, ".claude"));
    writeFileSync(join(main, ".claude", "cloud.json"), JSON.stringify({ version: NPM["agent-cloud-kit"] }));
    git(main, "add", ".");
  }
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  for (const [repo, versions] of Object.entries(tags)) {
    const bare = join(tmp, "github", `${repo}.git`);
    mkdirSync(dirname(bare), { recursive: true });
    git(tmp, "init", "-q", "--bare", "-b", "main", bare);
    git(main, "push", "-q", bare, "HEAD:main");
    for (const version of versions) git(main, "push", "-q", bare, `HEAD:refs/tags/v${version}`);
  }
  if (origin) {
    const bare = join(tmp, "origin.git");
    git(tmp, "init", "-q", "--bare", "-b", "main", bare);
    git(main, "remote", "add", "origin", bare);
    git(main, "push", "-q", "origin", "main");
    git(main, "remote", "set-head", "origin", "main");
  }
  for (const [name, as] of [["npx", ""], ["bun", "FAKE_AS=bun "], ["npm", "FAKE_AS=npm "], ["pnpm", "FAKE_AS=pnpm "]]) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${as}exec node "${join(HERE, "fake-tools.mjs")}" "$@"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const log = join(tmp, "calls.jsonl");
  const id = basename(tmp);
  // What the fake registry answers for this repo: the FAKE_NPM, FAKE_NPM_DEPS and FAKE_NPM_VERSIONS of the run.
  const serve = (env) => writeFileSync(join(tmp, "registry.json"), JSON.stringify({ latest: JSON.parse(env.FAKE_NPM ?? "{}"), deps: JSON.parse(env.FAKE_NPM_DEPS ?? "{}"), versions: JSON.parse(env.FAKE_NPM_VERSIONS ?? "{}") }));
  const env = (extra = {}) => ({
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_LOG: log,
    AGENT_KITCHEN_REGISTRY: `http://127.0.0.1:${PORT}/${id}`,
    FAKE_NPM: JSON.stringify(NPM),
    FAKE_CANDIDATES: JSON.stringify(CANDIDATES),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${join(tmp, "github")}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/",
    ...GIT_ENV,
    // Spanish, no color and no language for the tools, whatever the shell running the tests
    // has; a test can say otherwise.
    AGENT_KITCHEN_LANG: "",
    CLAUDE_REPO_GUARD_LANG: "",
    ISSUE_FLOW_LANG: "",
    NO_COLOR: "",
    ...extra,
  });
  return {
    tmp,
    main,
    // The URL of this repo's fake registry.
    registry: `http://127.0.0.1:${PORT}/${id}`,
    git: (...args) => git(main, ...args),
    // Runs the CLI with no terminal; the log of calls starts empty.
    cli(args, { env: extra = {}, cwd = main, runtime = process.execPath } = {}) {
      writeFileSync(log, "");
      const full = env(extra);
      serve(full);
      const result = spawnSync(runtime, [CLI, ...args], { cwd, encoding: "utf8", env: full });
      return { status: result.status, out: result.stdout, err: result.stderr };
    },
    // The npx and `bun x` calls of the last run, without `--yes` or `--bun`, nor the downloads
    // ahead of a step (`--package`) nor the reads of what the catalogs offer (`--candidates`).
    calls: () => npxCalls(log).filter((args) => args[0] !== "--package" && !args.includes("--candidates")),
    // Every npx and `bun x` call of the last run, without `--yes` or `--bun`.
    allCalls: () => npxCalls(log),
    // The program (npx or "bun x") of every call allCalls gives, in the same order.
    programs: () => toolCalls(log).map((call) => call.program),
    // Every npm call of the last run.
    npmCalls: () => logged(log, "npm"),
    // Every call of the last run, with the program and its GH_REPO.
    log: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []),
    read: (path) => JSON.parse(readFileSync(join(main, path), "utf8")),
    exists: (path) => existsSync(join(main, path)),
    write: (path, value) => {
      mkdirSync(dirname(join(main, path)), { recursive: true });
      writeFileSync(join(main, path), typeof value === "string" ? value : JSON.stringify(value, null, 2));
    },
  };
}

// A repo with nothing installed and no runner.json, which apply starts in runner mode.
export const makeFreshRepo = (options = {}) => makeRepo({ ...options, fresh: true });

// A repo as agent-kitchen leaves it at the given versions: the flow, its skills and the general
// ones, agent-cloud-kit, claude-repo-guard (with the flow's options) and the rule in AGENTS.md.
// With `origin`, the repo also gets a local origin (see makeRepo); these files are not committed.
export function installedRepo({ flow = "0.2.0", cloud = "0.9.1", guard = "0.2.0", general = "v0.2.0", tags, origin = false } = {}) {
  const repo = makeRepo({ ...(tags === undefined ? {} : { tags }), origin });
  repo.write("package.json", { devDependencies: { "@ramon-sg/issue-flow": flow, "@ramon-sg/github-rest": "0.2.1", "@ramon-sg/skills-manager": "1.2.0" } });
  repo.write(".agents/flow.json", {});
  repo.write("AGENTS.md", `${RULE}\n`);
  const flowSkill = { source: "catalog:ramon-sg/issue-flow", tag: `v${flow}` };
  repo.write(".agents/skills.json", { sources: [{ catalog: "ramon-sg/issue-flow", ref: `v${flow}`, skills: ["close-pr"] }, { catalog: "ramon-sg/agent-skills", skills: ["code-audit"] }] });
  repo.write(".agents/skills.lock.json", { lockVersion: 2, skills: { "close-pr": flowSkill, "pr-review-comments": flowSkill, "code-audit": { source: "catalog:ramon-sg/agent-skills", tag: general }, "test-audit": { source: "catalog:ramon-sg/agent-skills", tag: general } } });
  repo.write(".claude/cloud.json", { version: cloud });
  repo.write(".claude/repo-guard.manifest.json", { version: guard });
  repo.write(".claude/repo-guard.config.json", {
    environment: ["issue-flow is this repo's issue workflow: making the branch and worktree of an issue, its empty start commit, pushing it, opening its draft PR, assigning the issue and adding its \"Slug de rama\" block are normal steps of the work, not risky actions."],
    weakerNetworkIsolation: true,
  });
  return repo;
}
