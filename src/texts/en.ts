/**
 * @file The texts in English. The menu orders ("Update"), progress says what is happening
 * ("Updating") and the end line says what is left ("updated").
 */
import type { Catalog } from "./catalog.js";

/**
 * A list of names, joined with commas.
 * @param names - The names.
 * @returns The list.
 */
const list = (names: string[]): string => names.join(", ");

/** The texts in English. */
export const en: Catalog = {
  steps: {
    "skills-manager-create": ({ version }) => ({
      menu: `Create package.json with skills-manager ${version}`,
      doing: `Creating package.json with skills-manager ${version}…`,
      done: `package.json created with skills-manager ${version}`,
    }),
    "skills-manager-add": ({ version }) => ({
      menu: `Add skills-manager ${version} to package.json`,
      doing: `Adding skills-manager ${version} to package.json…`,
      done: `skills-manager ${version} added to package.json`,
    }),
    "skills-manager-bump": ({ from, to }) => ({
      menu: `Raise skills-manager ${from} → ${to}, agent-kitchen's minimum`,
      doing: `Raising skills-manager from ${from} to ${to}…`,
      done: `skills-manager raised from ${from} to ${to}`,
    }),
    "flow-install": ({ version }) => ({
      menu: `Install issue-flow ${version}: flow config, hooks and scripts`,
      doing: `Installing issue-flow ${version}…`,
      done: `issue-flow ${version} installed: flow config, hooks and scripts`,
    }),
    "flow-update": ({ from, to }) => ({
      menu: `Update issue-flow ${from} → ${to}, with its hooks and skills`,
      doing: `Updating issue-flow from ${from} to ${to}…`,
      done: `issue-flow updated from ${from} to ${to}, with its hooks and skills`,
    }),
    "flow-repair": ({ version }) => ({
      menu: `Repair issue-flow ${version}: hooks and $schema`,
      doing: `Repairing issue-flow ${version}…`,
      done: `issue-flow ${version} repaired: hooks and $schema`,
    }),
    "flow-skills": ({ version }) => ({
      menu: `Move the flow's skills to v${version}, issue-flow's version`,
      doing: `Moving the flow's skills to v${version}…`,
      done: `Flow skills at v${version}, issue-flow's version`,
    }),
    "flow-labels": ({ missing }) => ({
      menu: `Create the missing labels on GitHub: ${list(missing)}`,
      doing: `Creating the missing labels on GitHub: ${list(missing)}…`,
      done: `Labels created on GitHub: ${list(missing)}`,
    }),
    "github-rest-bump": ({ from, to, flow }) => ({
      menu: `Raise github-rest ${from} → ${to}, issue-flow ${flow}'s minimum`,
      doing: `Raising github-rest from ${from} to ${to}…`,
      done: `github-rest raised from ${from} to ${to}, issue-flow ${flow}'s minimum`,
    }),
    "cloud-install": ({ version }) => ({
      menu: `Install agent-cloud-kit ${version ?? "1.x"}: sets up Claude cloud sessions`,
      doing: `Installing agent-cloud-kit ${version ?? "1.x"}…`,
      done: `agent-cloud-kit ${version ?? "1.x"} installed: sets up Claude cloud sessions`,
    }),
    "cloud-update": ({ from, to, config }) => ({
      menu: `Update agent-cloud-kit ${from ?? "?"} → ${to} (the version ${config} pins)`,
      doing: `Updating agent-cloud-kit from ${from ?? "?"} to ${to}…`,
      done: `agent-cloud-kit updated from ${from ?? "?"} to ${to} in ${config}`,
    }),
    "guard-install": ({ version }) => ({
      menu: `Install claude-repo-guard ${version ?? "(main)"}: auto mode with sandbox, and a document of what it protects`,
      doing: `Installing claude-repo-guard ${version ?? "(main)"}…`,
      done: `claude-repo-guard ${version ?? "(main)"} installed: auto mode with sandbox, and a document of what it protects`,
    }),
    "guard-update": ({ from, to }) => ({
      menu: `Update claude-repo-guard ${from ?? "?"} → ${to}`,
      doing: `Updating claude-repo-guard from ${from ?? "?"} to ${to}…`,
      done: `claude-repo-guard updated from ${from ?? "?"} to ${to}`,
    }),
    "guard-adjust": () => ({
      menu: "Adjust claude-repo-guard to what the issue flow needs",
      doing: "Adjusting claude-repo-guard to the issue flow…",
      done: "claude-repo-guard adjusted to what the issue flow needs",
    }),
    "skills-install": ({ count, catalogs }) => ({
      menu: `Install ${count} skills from ${catalogs.join(" and ")}`,
      doing: `Installing ${count} skills from ${catalogs.join(" and ")}…`,
      done: `${count} skills installed from ${catalogs.join(" and ")}`,
    }),
    "skills-update": ({ catalog, from, to, names }) => ({
      menu: `Update skills from ${catalog} ${from} → v${to}: ${list(names)}`,
      doing: `Updating skills from ${catalog} from ${from} to v${to}…`,
      done: `Skills from ${catalog} updated to v${to}: ${list(names)}`,
    }),
    "skills-add": ({ names }) => ({
      menu: `Add new skills (${names.length}): ${list(names)}`,
      doing: `Adding new skills: ${list(names)}…`,
      done: `New skills added: ${list(names)}`,
    }),
    "agents-md": ({ rule, claudeImport }) => {
      const files = [...(rule ? ["AGENTS.md"] : []), ...(claudeImport ? ["CLAUDE.md"] : [])].join(", ");
      if (!rule)
        return {
          menu: `Add @AGENTS.md to CLAUDE.md, so Claude Code reads AGENTS.md: ${files}`,
          doing: "Adding @AGENTS.md to CLAUDE.md…",
          done: "@AGENTS.md added to CLAUDE.md: Claude Code reads AGENTS.md",
        };
      const also = claudeImport ? " (and @AGENTS.md in CLAUDE.md)" : "";
      return {
        menu: `Add the installed-versions rule to AGENTS.md${also}: ${files}`,
        doing: `Adding the installed-versions rule to AGENTS.md${also}…`,
        done: `Installed-versions rule added to AGENTS.md${also}`,
      };
    },
    "install-deps": ({ manager }) => ({
      menu: `Install the dependencies with ${manager}`,
      doing: `Installing the dependencies with ${manager}…`,
      done: `Dependencies installed with ${manager}`,
    }),
  },
  fresh: " (new)",
  failed: (menu) => `Failed: ${menu}`,
  duration: (ms) => {
    if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
    const seconds = Math.round(ms / 1000);
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min${seconds % 60 === 0 ? "" : ` ${seconds % 60} s`}`;
  },
  still: (elapsed) => `  … still running (${elapsed})`,
  checking: "Checking the repo and the latest versions…",
  upToDate: "All up to date: nothing to install or update.",
  allSet: "All up to date.",
  onlyOptional: (menus) => `Optional, to pick in a terminal: ${menus.join("; ")}.`,
  suggested: (dryRun) => `Suggested steps${dryRun ? "" : " (to run them, run agent-kitchen apply in a terminal, or with --yes)"}:`,
  summary: (failed) => (failed.length === 0 ? "Done." : `Finished, but these failed: ${failed.join("; ")}.`),
  next: (failedInstall) => `Left to do: ${failedInstall === null ? "" : `run '${failedInstall} install', `}review the diff and commit.`,
  cloudNext: "Next step for the cloud:",
  undecided: (names) => `New piece with no decision: ${list(names)}. Run agent-kitchen apply in a terminal to choose.`,
  ownSkillsKept: (names) => `Leaving out the skills the repo already has as its own: ${list(names)}. To replace them, run agent-kitchen apply in a terminal.`,
  saved: (file, commits) => `Saved which pieces the repo uses in ${file}${commits ? "" : "; commit it"}.`,
  noSteps: (why, wrote) => {
    if (why === "leave") return wrote ? "Ran no steps; only saved which pieces the repo uses." : "Nothing was changed.";
    return wrote ? "You picked no steps; only saved which pieces the repo uses." : "You picked nothing; nothing was changed.";
  },
  nothingChanged: "Nothing was changed.",
  cloning: (base) => `Working in a temporary copy of origin/${base}; your branch and your files are not touched.`,
  changes: "Changes in the PR:",
  noChanges: "No file changed: there is no PR to open.",
  prNotOpened: (why, clone) => {
    const reason = { step: "Did not open the PR because a step failed.", install: "Did not open the PR because the install failed.", git: "" }[why];
    return `${reason === "" ? "" : `${reason} `}The changes stay in the temporary copy ${clone}; delete it with rm -rf when you are done.`;
  },
  status: {
    heading: "This repo has:",
    offByRepo: "left out by the repo's decision",
    changePieces: (file) => `To change which pieces the repo uses: agent-kitchen apply --pieces (or edit ${file}).`,
  },
  here: {
    dirty: (changed) => `you already have uncommitted changes (${changed.length === 1 ? changed[0] : `${changed.length} files`}); apply's will mix with them.`,
    behind: (commits) => `your branch is ${commits} ${commits === 1 ? "commit" : "commits"} behind origin, as of the last fetch; run git pull first, or use --pr.`,
  },
  cli: {
    usage: (pieces) => `Usage:
  agent-kitchen apply [--yes | --dry-run] [--pr | --here] [--verbose] [--skip <piece>,...]
  agent-kitchen apply --pieces [--pr | --here]
  agent-kitchen doctor

agent-kitchen checks each piece of the repo's agent tooling (${pieces.join(", ")}),
shows what the repo has and the latest version of each, and apply offers to install what is
missing and update what is behind. In a terminal it asks once: do everything suggested, or
pick the steps and the skills. --yes does what is suggested without asking; without a
terminal it only shows it. --verbose shows each tool's output.
--pr works in a freshly fetched temporary copy of origin/<base>, without touching your branch:
it installs the dependencies, commits, pushes a new branch to origin and opens a draft PR.
--here works on the current branch and leaves the changes uncommitted; if the steps changed
package.json, it runs the install. In a terminal, without either, it asks; with --yes or
without a terminal, it uses --here. apply --pieces picks which pieces the repo uses and saves
it in .agents/kitchen.json (in a terminal, without --yes or --dry-run). Run it in the repo's
main checkout, from your terminal. Without a subcommand it does the same as apply, for now.

doctor runs each piece's checks at the repo's version, without changing anything.

Language: --lang es|en, or the AGENT_KITCHEN_LANG variable; Spanish by default. The commit
and the PR of --pr are always in Spanish.`,
    handOver: (latest, own) => `agent-kitchen: using ${latest}, the latest (this one is ${own}).`,
    noCommand: (words) => `there is no command ${words}.`,
    doctorNoOptions: "doctor takes no options, except --lang.",
    commitGone: "--commit no longer exists: use --pr to open a PR from a copy of origin, or --here to leave the changes uncommitted on the current branch.",
    bare: "agent-kitchen: use 'agent-kitchen apply'; without a subcommand it will stop installing in a major version.",
    lang: (source, value) => `${source} expects es or en: ${value}`,
    unknownPiece: (name, all) => `there is no piece ${name}; they are ${all.join(", ")}.`,
    yesAndDryRun: "use --yes or --dry-run, not both.",
    prAndHere: "use --pr or --here, not both.",
    piecesAlone: "use --pieces alone, without --yes or --dry-run.",
    piecesNeedsTerminal: "--pieces asks which pieces the repo uses; run it in a terminal.",
    prNeedsOrigin: "--pr needs an origin remote, and this repo has none. Use --here.",
    stopped: "Could not go on",
  },
  menu: {
    keys: { move: "move", mark: "select", next: "continue", choose: "choose", space: "Space:" },
    whatNow: "What should I do?",
    all: (count) => `Everything suggested (${count} ${count === 1 ? "step" : "steps"})`,
    recommended: "recommended",
    pick: "Pick what to do",
    leave: "Leave without changing anything",
    whichSteps: "Which steps should I run?",
    whichPieces: "Which pieces does this repo use?",
    whichSkills: "Which skills should I install?",
    replace: (own) => `The repo already has its own version of: ${own.join(", ")}. Replace them with the catalog's? Their project.md is kept.`,
    replaceYes: "Yes, replace",
    replaceNo: "No, leave them out",
    where: "Where should I apply the changes?",
    inPr: "In a new PR",
    inPrHint: (base) => `recommended · starts from origin/${base}, does not touch your branch or your files`,
    inHere: "On the current branch, uncommitted",
    inHereHint: "you review them with git diff and commit them yourself",
  },
  doctor: {
    allOk: "No check failed.",
    failed: (count) => (count === 1 ? "1 check failed." : `${count} checks failed.`),
  },
  repo: {
    outside: (command) => `run ${command} inside the repo.`,
    worktree: (command, main) => `run ${command} in the main checkout, ${main}, not in a worktree.`,
    badJson: (path, why) => `${path} is not valid JSON (${why}); fix it and run again.`,
    notObject: (path) => `${path} is not a JSON object; fix it and run again.`,
    noPackage: "there is no package.json.",
    notBoolean: (file, name) => `${file}: "${name}" is neither true nor false; treated as undecided.`,
  },
  pr: {
    noOrigin: "--pr needs an origin remote, and this repo has none.",
    gitStatus: (error) => `could not read git status: ${error}`,
    fetch: "could not fetch origin; check the connection or the credentials and run again.",
    noBranch: (base) => `origin has no branch ${base}.`,
    clone: (error) => `could not prepare the temporary copy: ${error}`,
    noRestVersion: (name) => `do not know which version of ${name} to use.`,
    restSilent: "github-rest failed without saying why.",
    commit: "Could not commit.",
    push: (branch) => `Could not push the branch ${branch} to origin.`,
    open: (branch, error) => `The branch ${branch} is on origin, but the PR could not be opened: ${error}`,
    byHand: "To open it by hand:",
    opened: "Draft PR opened.",
  },
  pieces: {
    common: {
      notInstalled: "not installed",
      upToDate: (version) => `${version}, up to date`,
      behind: (version, latest) => `${version}, ${latest} is out`,
      npmDown: " (npm does not answer)",
      notExactKept: (spec) => `package.json has ${spec}, not an exact version; left alone`,
      notExact: (spec) => `package.json has ${spec}, not an exact version`,
      inPackage: (name, version) => `${name} ${version} in package.json`,
      alreadyFine: "package.json already had a version that works",
      failed: (what, command) => `${what} failed; run '${command}'.`,
      doctorFailed: (command) => `its doctor could not run; run '${command}'`,
      behindRun: (version, latest) => `${version}, ${latest} is out: run npx agent-kitchen apply`,
    },
    skillsManager: {
      summary: "the skills CLI, which agent-kitchen runs",
      noPackage: "no package.json",
      missing: "not in package.json",
      below: (version, minimum) => `${version}, below ${minimum}`,
      rangeKept: (spec, runs, minimum) => `package.json has ${spec}, not an exact version; left alone${runs === null ? "" : `; runs ${runs}, below ${minimum}`}`,
      checkMissing: (minimum) => `not in package.json; run npx agent-kitchen apply to pin ${minimum}`,
      checkBelow: (version, minimum) => `${version}, below ${minimum}, agent-kitchen's minimum: run npx agent-kitchen apply`,
      checkOk: (version, minimum) => `${version} (minimum ${minimum})`,
      checkRangeBelow: (spec, runs, minimum) => `${spec} runs ${runs}, below ${minimum}, agent-kitchen's minimum: raise the range`,
      checkRange: (spec, runs) => `${spec}${runs === null ? "" : `, runs ${runs}`}`,
    },
    flow: {
      summary: "branch, worktree and draft PR per issue",
      labelsUnread: " (could not read the labels from GitHub)",
      skillAt: (name, tag) => `${name} at ${tag ?? "no tag"}`,
      catalogAt: (ref) => `the catalog at ${ref ?? "the latest"}`,
      skillsMoved: (version, names) => `flow skills at v${version}: ${list(names)}`,
      skillsFailed: (command) => `skills-manager did not update the flow's skills; run '${command}' and then agent-kitchen apply again.`,
      silent: (command) => `issue-flow apply did not say what it did; run '${command}'.`,
      labelsSkipped: (version) => `not created: the repo does not have issue-flow ${version}`,
      restSkipped: (version) => `not raised: the repo does not have issue-flow ${version}`,
      noJsonDoctor: (version) => `${version} has no doctor --json: run npx agent-kitchen apply to update it`,
      noSkills: "none installed",
      skillsAt: (count, version) => `${count} at v${version}`,
      skillsBehind: (off, version) => `${list(off)}; issue-flow is at ${version}: run npx agent-kitchen apply`,
      labelsCheckUnread: "could not read them from GitHub",
      labelsMissing: (missing) => `${list(missing)} missing on GitHub; run npx agent-kitchen apply`,
      labelsOk: "GitHub has the ones the flow expects",
    },
    cloud: {
      summary: "Claude cloud sessions",
      unpinned: (config) => `${config} pins no version`,
      checkUnpinned: (config, example) => `${config} pins no exact version: put the one in use in "version", like "${example}"`,
    },
    guard: {
      summary: "guardrails: auto mode with sandbox",
      sandbox: (command) => `claude-repo-guard was not installed: it had no permission to write in the repo. If you run agent-kitchen inside a Claude session, its sandbox blocks .claude/settings.json; run '${command}' from your terminal.`,
      failed: (command) => `claude-repo-guard was not installed; its error is below. To retry by hand: '${command}'.`,
      explainsFlow: "explains the issue flow to auto mode",
      integration: (branch) => `integration branch ${branch}`,
      weaker: (option) => `${option} turned on, so gh works in the macOS sandbox`,
      optionsFine: "its options already have what the flow needs",
      noTag: " (GitHub has no version)",
      unknown: "unknown version",
      checkNotInstalled: "not installed (Claude opens with your own permissions)",
      checkWeaker: (config) => `not turned on in ${config}, so gh fails in the macOS sandbox: run npx agent-kitchen apply`,
      checkOk: (version) => `${version}, its doctor passes`,
    },
    skills: {
      summary: "flow skills, plans and audits",
      notInstalled: "not installed",
      catalogsUnread: " (could not read the catalogs)",
      installed: (count, behind) => `${count} installed${behind ? ", some behind" : ", up to date"}`,
      withoutFlow: "without the flow's skills, since issue-flow is not installed",
      none: "no skill to install",
      count: (count) => `${count} skills`,
      replaced: (names) => `replaced (keeping their project.md): ${list(names)}`,
      installFailed: (command) => `skills-manager did not install the skills; run '${command}'.`,
      updateFailed: (catalog, command) => `skills-manager did not update ${catalog}; run '${command}' and then agent-kitchen apply again.`,
      checkOk: "skills-manager check passes",
      checkFailed: (command) => `the disk, the lock and the manifest do not match: run '${command}'`,
    },
    agentsMd: {
      summary: "installed-versions rule in AGENTS.md",
      upToDate: "up to date",
      noRule: "the rule is missing",
      noImport: "CLAUDE.md does not import AGENTS.md",
      noPackage: "no package.json: nothing was added",
      checkNoRule: "the versions rule is missing from AGENTS.md; run npx agent-kitchen apply",
      checkNoImport: "CLAUDE.md does not import AGENTS.md, so Claude Code does not read it; run npx agent-kitchen apply",
      checkOk: "versions rule in AGENTS.md",
    },
  },
};
