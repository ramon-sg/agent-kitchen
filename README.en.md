# agent-kitchen

[Español](README.md)

One command to install, update and check what a repo uses to work with agents: the issue flow with its skills, the general skills, Claude cloud sessions and the safety guardrails.

```sh
bunx agent-kitchen apply    # shows what is there, what is missing and what is behind, and asks
bunx agent-kitchen doctor   # checks that everything works, without changing anything
```

With Node it is `npx agent-kitchen apply`. The tools run with the repo's runner (Bun by default) and the exact versions in `.agents/runner.json`, with no `node_modules` for them: see [The runner and `.agents/runner.json`](#the-runner-and-agentsrunnerjson).

What each tool and each skill does, and where they are: [docs/README.md](docs/README.md) for people and [docs/agent-guide.md](docs/agent-guide.md) for agents.

On start it checks whether npm has a newer version of itself. If it does, it runs that one with the same arguments and the same runtime it was started with (`bunx` if it runs on Bun, `npx` if it runs on Node), so it never uses an old copy from a cache.

## In short

- Shows each piece with the version the repo has and whether it is up to date.
- Asks once: **Everything suggested** (Enter), **Pick what to do** (the steps and the skills), or **Leave without changing anything**. All questions come before installing; after that it runs on its own.
- Each step is one line with ✓ or ✗. A tool's output only appears if it fails, or with `--verbose`.
- It is fast: all versions are looked up at once and the tools download while you answer.
- Each piece is installed by its own tool. `agent-kitchen` only knows which pieces exist, which version they are at and how they connect to each other. The exceptions are one line in `AGENTS.md` and, in a legacy repo (no `.agents/runner.json`), in `package.json` the `skills-manager` version and the `github-rest` version when it falls below issue-flow's minimum, which it writes itself.
- Running it again breaks nothing: if everything is up to date, it says so and stops.

## The pieces

| Piece | What it is | Repo version | Latest | Install | Update |
|---|---|---|---|---|---|
| `runner` | The move of a legacy repo to `.agents/runner.json` (see [below](#moving-a-legacy-repo)). In a repo that already moved it shows the runner and, if a move was cut short, offers to finish it. With `--runner`, it changes the runner | `.agents/runner.json` | — | `agent-kitchen` creates it: in a new repo at the start, in a legacy one with the move | The move, finishing the move or `--runner` |
| `skills-manager` | The version of [`@ramon-sg/skills-manager`](https://github.com/ramon-sg/skills-manager) that `agent-kitchen` runs: at least 1.2.0. If it is missing it adds it and if it is lower it raises it; it never lowers it. A range or `workspace:` is left alone, and it warns if the version that runs is below the minimum. Only in repos that use skills and have a `package.json`, or where issue-flow is installed in the same run: then it creates the `package.json`. In runner mode it does not touch `package.json`: the version goes in `.agents/runner.json` | `.agents/runner.json` (legacy: `package.json`) | — | `agent-kitchen` adds it | `agent-kitchen` raises it |
| `issue-flow` | Issue flow ([`@ramon-sg/issue-flow`](https://github.com/ramon-sg/issue-flow)): branch, worktree and draft PR per issue, and its 5 skills | `.agents/runner.json` (legacy: `package.json`) | npm | `issue-flow apply` (`init` before 0.3.0), and its skills at the same tag | `issue-flow apply` at the new version (`upgrade` before 0.3.0), and its skills at the same tag. Since 0.3.0, if its doctor sees hooks or the `$schema` behind, `apply` at the repo's version. Since 0.3.0, if `github-rest` is an exact version below the minimum that version of the flow asks for, it raises it. Since 0.2.6, if GitHub is missing flow labels (`spike`, `P1`–`P4`…), `issue-flow labels sync` creates them |
| `agent-cloud-kit` | Cloud sessions ([`agent-cloud-kit`](https://github.com/ramon-sg/agent-cloud-kit)): tools, Docker and the full clone | `.agents/runner.json` (legacy: `version` in `.claude/cloud.json`), `.agents/skills/cloud-ready/` | npm | `agent-cloud-kit init` | Changes the version that `.agents/runner.json` pins (in legacy mode, `.claude/cloud.json`) and runs the new version's `init`, so the `cloud-ready` skill stays the same. When `apply` ends it suggests `agent-cloud-kit prepare` with the repo's runner |
| `claude-repo-guard` | Guardrails ([`claude-repo-guard`](https://github.com/ramon-sg/claude-repo-guard)): auto mode with sandbox, writes only in its worktree | `.agents/runner.json` (legacy: `.claude/repo-guard.manifest.json`) | npm in runner mode; GitHub `vX.Y.Z` tags in legacy mode | `apply` at that tag (`install` before 0.5.0) | `apply` at the new tag |
| `skills` | Skills with [`skills-manager`](https://github.com/ramon-sg/skills-manager): the flow's and those from [`agent-skills`](https://github.com/ramon-sg/agent-skills) (plans, code and test audits) | `.agents/skills.lock.json` | Catalog tags | `skills-manager init --select` with the chosen ones | `skills-manager update` |
| `agents-md` | One line in `AGENTS.md` that asks the agent to look at a library's installed version before using it. If the repo has `CLAUDE.md`, it adds `@AGENTS.md` to it, because otherwise Claude Code does not read `AGENTS.md`. Only in repos with a `package.json`; in runner mode, only if the repo has dependencies of its own (without them there is no `node_modules` to look at) | `AGENTS.md` | — | `agent-kitchen` writes it | — |

If npm or GitHub do not answer, the piece is shown but not offered for update. If a step fails, the others go on and the command says how to retry it.

### How they connect

- **The flow's skills go with its CLI,** because it calls them: they are installed at the tag of the flow's version and move with it. The general ones each carry their own version.
- **Which skills:** the first time, all of the catalogs' skills come. With "Pick what to do" a menu appears grouped by catalog, with each one's description. If a catalog has skills the repo does not have, they are offered as an unchecked step.
- **The repo's own skills:** if the repo already has a folder named like a catalog skill, it asks once whether to replace them. When replacing, its `project.md` is kept. With `--yes` they are not replaced: they are left out and it says so.
- **Safety and flow:** if the repo has the flow, before installing `claude-repo-guard` it writes in its options that opening the PR as a draft, assigning the issue and adding the "Slug de rama" are part of normal work. It also writes the flow's base branch as `integrationBranch`. On macOS it adds `weakerNetworkIsolation`, which `gh` needs inside the sandbox. If `claude-repo-guard` was already up to date but is missing those options, they are offered as a step.
- **Which pieces the repo uses:** `.agents/kitchen.json` stores, per piece, whether the repo wants it (`{ "pieces": { "claude-repo-guard": false } }`). It is created on the first `apply` run in a terminal: what is installed counts as yes, and what it offered and you did not check, as no. `false` leaves the piece out of the menu and out of `--yes`, without uninstalling it; the table says so and `doctor` does not run its checks. A piece the file does not mention is offered once, marked "(new)"; with `--yes` or without a terminal it is left out, if it is not installed, and it says so (one already installed is updated as usual). `--yes`, `--dry-run`, `--skip` and runs without a terminal never write the file. It is changed with `apply --pieces` or by hand. `skills-manager` has no decision: its skills stay in `.agents/skills.json`.
- **The cloud does not bother you locally:** the session hook only acts in the cloud. A repo that is never opened there loses nothing.

## The runner and `.agents/runner.json`

A repo in **runner mode** runs each tool with the runner and the exact version pinned in `.agents/runner.json`. The file is committed:

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/@ramon-sg/runner@1.0.0/runner.schema.json",
  "runner": "bun",
  "tools": {
    "@ramon-sg/issue-flow": "0.6.0",
    "@ramon-sg/github-rest": "0.7.0",
    "@ramon-sg/skills-manager": "1.5.1",
    "@ramon-sg/claude-repo-guard": "0.8.0",
    "agent-cloud-kit": "1.0.0"
  }
}
```

- **`runner`** is `"bun"` or `"node"`; without it, Bun. **`tools`** holds each tool's exact version, under its package name (always scoped).
- **Who writes each entry:** the tool itself, when it is installed or updated (`issue-flow` its own and `github-rest`'s; `skills-manager`, `claude-repo-guard` and `agent-cloud-kit` each its own). `agent-kitchen` creates the file with the `runner`, and when moving a repo it pins a tool's entry if the tool did not. Commit the file: it is what makes the repo, its worktrees and the cloud run the same versions.
- **Commands:** with Bun, `bunx --bun <package>@<version> …`; with Node, `npx --yes <package>@<version> …`. The hooks and the `package.json` shortcuts (`issue:start`, `claude:auto`…) are written that way, with the pinned version. The tools do not go through `node_modules`: only what the repo uses on its own is installed.
- **Legacy mode:** a repo without `.agents/runner.json` goes on as always: versions in `package.json`, `.claude/cloud.json` and the guard's manifest, and everything through `npx`. So that a repo is never half migrated, in legacy mode only versions below the first one that reads `runner.json` are offered: `issue-flow` 0.6.0, `skills-manager` 1.5.0, `claude-repo-guard` 0.8.0 and `agent-cloud-kit` 1.0.0.
- **New repos** (no `runner.json` and no tool installed) are born with it. It uses Bun if installed; otherwise, in a terminal it asks, and without a terminal it uses Node and warns. With `--dry-run` it writes nothing. `--runner` sets it without asking.
- **Versions** are looked up in the npm registry: `AGENT_KITCHEN_REGISTRY`, else `npm_config_registry`, else `registry.npmjs.org`. Known limit: behind an HTTP(S) proxy, Node's `fetch` does not use it, lookups return nothing and no update is offered (it does not fail).

### Moving a legacy repo

`apply` offers the `runner` step, "move the tools to `.agents/runner.json`", when the repo has tools installed the legacy way and **npm's latest version of each one already reads `runner.json`**. It is all or nothing: if one lacks that version, or `issue-flow` is in `package.json` with a range, the step does not appear and the table says what is missing. It also waits if the run leaves out a piece with `--skip`. While it is offered, the tools offer none of their legacy steps.

The step runs in this order and stops at the first part that fails (nothing is undone):

1. Writes `.agents/runner.json` with the runner (Bun if installed) and `github-rest`, never lowering it. It goes first because the guard, with its manifest and no `runner.json`, stays in legacy mode.
2. `issue-flow apply` at its new version: rewrites its hooks and shortcuts.
3. `claude-repo-guard apply` from npm.
4. `agent-cloud-kit init`.
5. `skills-manager` at its new version, and the flow's skills at the flow's new tag.
6. The cleanup.

**What it removes:** the ecosystem tools from `dependencies` and `devDependencies`, the scripts that were only a `skills-manager` command, `version` in `.claude/cloud.json`, and `node_modules` and the lockfile **only if `package.json` has no dependency left**. **What it keeps:** the guard's manifest (its `uninstall` uses it), the `.claude/cloud.json` file and `package.json` with the shortcuts. If the repo has dependencies of its own, it runs the lockfile's package manager install at the end. With `--pr`, the commit carries the updated or deleted lockfile.

If the move is cut short, the repo stays in runner mode with the tools that failed having no entry: the next `apply` offers them again and offers "finish the move to `.agents/runner.json`", which does whatever cleanup is left. Run it again until it offers nothing.

**Run it in your terminal.** Neither the move nor the guard's `apply` is run from a Claude Code session that already has the guard installed: the sandbox blocks `.claude/settings.json`.

### Changing the runner

`apply --runner bun|node` changes the runner of a repo in runner mode: it writes `runner`, runs each tool's `apply` at its version (which rewrites hooks and shortcuts) and adjusts `packageManager` in `package.json` (`bun@<version>` with Bun, none with Node), only if the repo has no dependencies of its own. In a legacy repo, it does the move with that runner. With the runner the repo already has, `--runner <the same>` runs every tool again: use it to finish a change that was cut short. `doctor` does not accept `--runner`.

## Usage

```sh
bunx agent-kitchen apply                       # (with Node: npx) asks, in a terminal (Enter: everything suggested)
npx agent-kitchen apply --dry-run              # only shows what it would do
npx agent-kitchen apply --yes                  # does what is suggested without asking
npx agent-kitchen apply --pr                   # in a copy of origin, and opens a draft PR
npx agent-kitchen apply --here                 # on the current branch, no commit
npx agent-kitchen apply --verbose              # shows each tool's output
npx agent-kitchen apply --skip agent-cloud-kit    # leaves out a piece (or several, with commas)
npx agent-kitchen apply --runner node             # changes the repo's runner (bun or node): rewrites runner.json, hooks and shortcuts of each tool; in a legacy repo it does the move with that runner
npx agent-kitchen apply --pieces               # changes which pieces the repo uses (only in a terminal)
npx agent-kitchen doctor                       # checks each piece with its own doctor
npx agent-kitchen apply --lang en              # the terminal in English (or AGENT_KITCHEN_LANG=en)
```

- **Without a subcommand** (`npx agent-kitchen`) it does the same as `apply`, for now, and warns to use `apply`. In a major version it will only show the status.

- **Without a terminal and without `--yes`** (for example, from an agent), it only shows what it would offer.
- **Run it in the main checkout,** not in a worktree, and from your terminal. Inside a Claude session, the `claude-repo-guard` sandbox does not allow writing `.claude/settings.json`: the move to `runner.json` and the guard's `apply` are run in a terminal.
**Where it works.** In a terminal, without `--pr` or `--here`, the first thing it asks is where to apply the changes. With `--yes`, without a terminal or without an `origin` remote, it works on the current branch.

**`--pr`** leaves the changes in a PR without touching your branch or your files:

- **It starts from origin, not from your branch.** It runs `git fetch` and clones the repo into a temporary folder at `origin/<base>`: `baseBranch` from `.agents/flow.json`, otherwise `origin`'s default branch, otherwise `main`. It does not matter if your branch is behind, is another one or has changes: neither your files nor your `node_modules` change. It is a clone and not a worktree because `issue-flow apply` does not run in a worktree; the clone shares the repo's objects, so it does not copy the history.
- **At the end,** it installs the dependencies in the clone (the repo's hooks may need them; in runner mode, only if the repo has dependencies of its own that changed) and makes the commit with your repo's hooks, name and signature. The lockfile is included only if `package.json` changed.
- **It pushes the branch straight to origin.** Your repo pushes the commit to `chore/agent-kitchen-apply-<date>` without creating a local branch, and opens the draft PR with `@ramon-sg/github-rest`. After the merge, `git fetch --prune` cleans up the `origin/chore/…` reference.
- **If something fails before the push** (a step, the install or the commit), it pushes nothing and leaves the clone for you to review; the output says where it is. If the push works and the PR fails, the output says what to run.

**`--here`** works on the current branch, in your files, like `ng update` or `copier update`. It warns if you already have uncommitted changes or if your branch is behind origin as of the last fetch. If the steps changed `package.json`, it runs your package manager's `install` at the end (in runner mode, only if `package.json` keeps dependencies). What is left for you is to review the diff and commit.

**`doctor`** runs each tool's doctor at the repo's version (in runner mode, with the repo's runner). In runner mode it also checks that `.agents/runner.json` is valid, that the runner is installed (`bunx` or `npx`) and fails if an installed tool is not pinned in it; each tool also passes its own doctor, which checks its hooks and shortcuts. A `runner.json` that cannot be used stops the command with an error. In legacy mode it adds nothing. The tools are: `issue-flow doctor --json`, `skills-manager check` and `claude-repo-guard doctor --json`. It also checks that `skills-manager` is at least 1.2.0, that the flow's skills are at the tag of its CLI, which flow labels GitHub is missing (with `·`), that `agent-cloud-kit`'s version is exact (in `.agents/runner.json`; in legacy mode, `.claude/cloud.json`) and, on macOS, `weakerNetworkIsolation`. In a repo with a `package.json`, also the `AGENTS.md` line and, if there is a `CLAUDE.md`, its `@AGENTS.md`. What is not installed or has a newer version is only noted with `·`. It exits with 1 if something fails (`✗`).

**Language.** The terminal speaks Spanish by default. `--lang en`, or the variable `AGENT_KITCHEN_LANG=en`, switches it to English; `--lang` wins over the variable, and `LANG` is not looked at. agent-kitchen hands that language to claude-repo-guard (`CLAUDE_REPO_GUARD_LANG`) and to issue-flow (`ISSUE_FLOW_LANG`) when it installs or updates them, so what they print when they fail comes in the same language. Their `doctor`s and the read of issue-flow's labels get it too, so a value in the shell that they refuse does not make them fail; when agent-kitchen reads the text of issue-flow's doctor to decide whether to repair, it asks for English. What stays in the repo does not change language: the commit and the PR of `--pr`, the `AGENTS.md` line and the `claude-repo-guard` options. The texts are in `src/texts/es.ts` and `src/texts/en.ts`, with the same type; a test checks that they have the same keys.

**Kuro.** `apply` and `doctor` end with a block next to Kuro, issue-flow's ninja cook: how it went, what is left and the next command. Errors that stop the command come out the same way, on stderr. Kuro only appears in a terminal, color is turned off with `NO_COLOR`, and `"art": false` in `.agents/kitchen.json` or in `.agents/flow.json` removes it.

## Adding a piece

A piece is a file in `src/pieces/` with two async functions: `status(root)` says what the repo has and which steps it offers, and `checks(root)` gives its checks for `doctor`. A step says which packages to download beforehand (`downloads`) and never asks anything: the questions come earlier, in `src/menu.ts`. It is registered in `PIECES` in `src/commands/sync.ts` and in `src/commands/doctor.ts`. Each step runs the piece's tool, which owns its files. A new skills catalog is one line in `GENERAL_CATALOGS` in `src/piece.ts`.

## Development

```sh
npm install
npm test        # builds and runs the tests
```

The tests run the built CLI on real repos. `npx`, `bunx` and `npm` are fakes (`test/fake-tools.mjs`) and record every call. GitHub tags come from local repos that git reaches by rewriting `https://github.com/`, so `git ls-remote` is the real one. The menus are not tested rendered: `menuOptions` and `skillOptions` are tested, and they were run in a terminal with `expect`. With `@clack/prompts` 1.8.1, a spinner shown before a question leaves the second question without keyboard; that is why the initial check is a line of text.

## Publishing a version

A version is a `vX.Y.Z` release on GitHub, with the same number as `package.json`. When it is published, GitHub Actions runs the tests and publishes to npm with provenance (`.github/workflows/publish.yml`).

The first version goes by hand, because npm only lets you set up publishing from GitHub on a package that already exists:

1. `npm login` and, from `main`, `npm publish --provenance=false`.
2. On npmjs.com, in the package, Settings → Trusted publishing: GitHub Actions, repo `ramon-sg/agent-kitchen`, workflow `publish.yml`.
3. Push that version's tag without creating a release: a release would publish the same version again and fail.

## License

MIT
