/**
 * @file The issue flow (`@ramon-sg/issue-flow`): its CLI, hooks and config, and its skills.
 * The repo's version is the one in package.json. From 0.3.0, installing and updating run its
 * `apply` at the latest version, and reading its `--json` tells what it kept as it was; at
 * the repo's version, `apply` also repairs hooks or a `$schema` its doctor finds behind (a
 * version raised by hand or by Dependabot). Before 0.3.0, installing runs `init` and
 * updating runs `upgrade`. After updating or repairing, and after installing with `apply`,
 * the flow's skills move to the same tag, because they call the CLI. If only the skills are
 * off, they move alone. From 0.2.6 it also offers `labels sync`, after the install or
 * update, when GitHub lacks some of the labels the flow expects. From 0.3.0, whose `apply`
 * keeps the repo's github-rest, it also raises an exact github-rest below the floor of the
 * range that version of the flow declares on npm, as the flow itself reads it.
 * `apply` and `init` run with `--yes`: the person answered agent-kitchen's questions before
 * the steps.
 */
import { type Check, type Context, FLOW_CATALOG, FLOW_CONFIG, FLOW_PACKAGE, type PieceStatus, type Step } from "../piece.js";
import { dependencyVersion, isObject, readJson, setDependency } from "../repo.js";
import { catalogSkills, manifestCatalogs, pinCatalog, updateSkills } from "../skills-files.js";
import { captureNpx, compareVersions, isRelease, npmDependencies, npmLatest, runNpx } from "../tools.js";

/** The piece's name, as `--skip` takes it. */
export const NAME = "issue-flow";

/** How the catalog's ref is named when it is off. */
const SKILLS_CATALOG_LABEL = "el catálogo";

/** The first version whose `doctor` prints `--json`. */
const JSON_DOCTOR = "0.2.0";

/** The first version with `labels sync`. */
const LABELS_SINCE = "0.2.6";

/** The first version whose `apply` installs, updates and repairs, instead of `init` and `upgrade`. */
const APPLY_SINCE = "0.3.0";

/** The client of GitHub's REST API that the flow's skills call. */
const GITHUB_REST = "@ramon-sg/github-rest";

/** One check of the flow's `doctor --json`. */
interface FlowCheck {
  name?: unknown;
  ok?: unknown;
  detail?: unknown;
}

/**
 * Whether a version installs and updates with `apply`.
 * @param version - The flow's version.
 * @returns True from 0.3.0 on.
 */
function usesApply(version: string): boolean {
  return compareVersions(version, APPLY_SINCE) >= 0;
}

/**
 * The issue flow's version in the repo, as package.json has it: an exact release when the
 * flow set it up, or anything else (a range, a `file:` link) someone wrote by hand.
 * @param root - The repo.
 * @returns The version in package.json, or null.
 * @example flowVersion(root) // "0.2.0"
 */
export function flowSpec(root: string): string | null {
  return dependencyVersion(readJson(root, "package.json"), FLOW_PACKAGE);
}

/**
 * The issue flow's release in the repo: what package.json pins, if it is an exact release.
 * @param root - The repo.
 * @returns The version, or null if there is none or it is not a release.
 * @example flowVersion(root) // "0.2.0"
 */
export function flowVersion(root: string): string | null {
  const spec = flowSpec(root);
  return spec !== null && isRelease(spec) ? spec : null;
}

/**
 * The flow's skills that are not at a version's tag, or the catalog pinned elsewhere.
 * @param root - The repo.
 * @param version - The flow's version.
 * @returns Their names; the catalog's ref as well if it is off.
 */
function skillsOff(root: string, version: string): string[] {
  const tag = `v${version}`;
  const off = catalogSkills(root, FLOW_CATALOG).filter((skill) => skill.tag !== tag).map((skill) => `${skill.name} en ${skill.tag ?? "sin tag"}`);
  const source = manifestCatalogs(root).find((item) => item.catalog === FLOW_CATALOG);
  return source !== undefined && source.ref !== tag ? [...off, `${SKILLS_CATALOG_LABEL} en ${source.ref ?? "la última"}`] : off;
}

/**
 * Moves the flow's skills to a version's tag: the catalog's ref in the manifest, and then
 * `skills-manager update` on them.
 * @param context - Where it runs.
 * @param version - The flow's version.
 * @returns Whether it worked, or true if the repo has none of the flow's skills.
 */
async function moveSkills(context: Context, version: string): Promise<boolean> {
  if (!pinCatalog(context.root, FLOW_CATALOG, `v${version}`)) return true;
  const names = catalogSkills(context.root, FLOW_CATALOG).map((skill) => skill.name);
  const failed = await updateSkills(context.root, names);
  if (failed === null) {
    context.note(`skills del flujo en v${version}: ${names.join(", ")}`);
    return true;
  }
  context.fail(`skills-manager no actualizó las skills del flujo; corre '${failed.command}' y luego agent-kitchen apply otra vez.`, failed.run.output);
  return false;
}

/**
 * Runs the flow's own command at a version.
 * @param context - Where it runs.
 * @param version - The version.
 * @param args - The command and its flags.
 * @returns Whether it exited 0.
 */
async function runFlow(context: Context, version: string, args: string[]): Promise<boolean> {
  const run = await runNpx(context.root, [`${FLOW_PACKAGE}@${version}`, ...args]);
  if (run.ok) return true;
  context.fail(`issue-flow ${args[0] ?? ""} falló; corre 'npx ${FLOW_PACKAGE}@${version} ${args.join(" ")}'.`, run.output);
  return false;
}

/**
 * Runs the flow's `apply` at a version and reads its `--json`: what it kept as it was goes as
 * a note. Output that is not its JSON counts as a failure, since it does not tell what it wrote.
 * @param context - Where it runs.
 * @param version - The version, 0.3.0 or later.
 * @returns Whether it worked.
 */
async function applyFlow(context: Context, version: string): Promise<boolean> {
  const retry = `npx ${FLOW_PACKAGE}@${version} apply --yes`;
  const result = await captureNpx(context.root, [`${FLOW_PACKAGE}@${version}`, "apply", "--yes", "--json"]);
  const output = `${result?.out ?? ""}${result?.err ?? ""}`;
  if (result === null || result.status !== 0) {
    context.fail(`issue-flow apply falló; corre '${retry}'.`, output);
    return false;
  }
  let report: unknown;
  try {
    report = JSON.parse(result.out);
  } catch {
    report = null;
  }
  if (!isObject(report) || !Array.isArray(report.kept)) {
    context.fail(`issue-flow apply no dijo qué hizo; corre '${retry}'.`, output);
    return false;
  }
  for (const line of report.kept) context.note(String(line));
  return true;
}

/**
 * The flow's own `doctor --json` at a version.
 * @param root - The repo.
 * @param version - The version, 0.2.0 or later.
 * @param lookup - True to give up after the lookups' time limit, as the status does.
 * @returns Its checks, or null if it could not run or its output is not a list.
 */
async function flowDoctor(root: string, version: string, lookup = false): Promise<FlowCheck[] | null> {
  const result = await captureNpx(root, [`${FLOW_PACKAGE}@${version}`, "doctor", "--json"], lookup);
  try {
    const found: unknown = JSON.parse(result?.out ?? "");
    return Array.isArray(found) ? (found as FlowCheck[]) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the flow's doctor finds what `apply` repairs: a hook missing or behind, or the
 * config's `$schema` behind. A config that is invalid fails the same check but `apply` cannot
 * fix it, so the `$schema` is told by its detail; and a hook newer than the repo's version
 * makes `apply` refuse, so it does not count.
 * @param checks - The doctor's checks.
 * @param version - The repo's version.
 * @returns True if `apply` would repair them.
 */
function needsRepair(checks: FlowCheck[], version: string): boolean {
  const hookBehind = (detail: string): boolean => {
    const found = /^at (\d+\.\d+\.\d+)/.exec(detail)?.[1];
    return found === undefined || compareVersions(found, version) < 0;
  };
  return checks.some((check) => check.ok === false && (String(check.name).endsWith(" hook") ? hookBehind(String(check.detail)) : check.name === FLOW_CONFIG && String(check.detail).includes("$schema")));
}

/**
 * The labels the flow expects that GitHub lacks, as `labels sync --dry-run --json` of a
 * version tells (a label that only differs in color or description does not count).
 * @param root - The repo.
 * @param version - The flow's version.
 * @returns Their names, none for a version without `labels sync`, or null if it could not tell.
 * @example await missingLabels(root, "0.2.6") // ["spike"]
 */
async function missingLabels(root: string, version: string): Promise<string[] | null> {
  if (compareVersions(version, LABELS_SINCE) < 0) return [];
  const result = await captureNpx(root, [`${FLOW_PACKAGE}@${version}`, "labels", "sync", "--dry-run", "--json"], true);
  let found: unknown;
  try {
    found = JSON.parse(result?.out ?? "");
  } catch {
    return null;
  }
  if (!isObject(found) || !Array.isArray(found.labels)) return null;
  return found.labels.filter((label) => isObject(label) && label.status === "to-create").map((label) => String((label as { name?: unknown }).name));
}

/**
 * The step that makes in GitHub the labels the flow lacks, with its own command. It only
 * runs if the repo has that version of the flow by then: not when its install or update
 * was left out or failed.
 * @param version - The flow's version.
 * @param missing - The labels.
 * @returns The step.
 */
function labelsStep(version: string, missing: string[]): Step {
  return { piece: NAME, checked: true, downloads: [`${FLOW_PACKAGE}@${version}`], text: { kind: "flow-labels", missing }, run: async (context) => {
    if (flowVersion(context.root) !== version) {
      context.note(`no se crearon: el repo no tiene issue-flow ${version}`);
      return true;
    }
    return runFlow(context, version, ["labels", "sync"]);
  } };
}

/**
 * The lowest github-rest a version of the flow works with: the floor of the range it declares
 * on npm (`^0.3.0` gives 0.3.0), as the flow reads it from its own package.json.
 * @param version - The flow's version.
 * @returns The version, or null before 0.3.0 (its `upgrade` raises github-rest) or if npm cannot tell.
 * @example await restMinimum("0.3.0") // "0.3.0"
 */
async function restMinimum(version: string): Promise<string | null> {
  if (!usesApply(version)) return null;
  const range = (await npmDependencies(`${FLOW_PACKAGE}@${version}`))?.[GITHUB_REST]?.replace(/^[\^~]/, "");
  return range !== undefined && isRelease(range) ? range : null;
}

/**
 * The step that raises github-rest to a version of the flow's minimum, if package.json has an
 * exact version below it. A missing one gets none: `apply` adds it at the minimum. A range is
 * the repo's own choice. At run time it reads package.json again, and raises nothing unless
 * the repo has that version of the flow by then.
 * @param root - The repo.
 * @param version - The flow's version the repo ends at.
 * @param minimum - The lowest github-rest it works with.
 * @returns The step, or null.
 */
function restStep(root: string, version: string, minimum: string): Step | null {
  const below = (rest: string | null): rest is string => rest !== null && isRelease(rest) && compareVersions(rest, minimum) < 0;
  const current = dependencyVersion(readJson(root, "package.json"), GITHUB_REST);
  if (!below(current)) return null;
  return { piece: NAME, checked: true, downloads: [], text: { kind: "github-rest-bump", from: current, to: minimum, flow: version }, run: async (context) => {
    if (flowVersion(context.root) !== version) context.note(`no se subió: el repo no tiene issue-flow ${version}`);
    else if (!below(dependencyVersion(readJson(context.root, "package.json"), GITHUB_REST))) context.note("package.json ya tenía una versión que sirve");
    else {
      setDependency(context.root, GITHUB_REST, minimum);
      context.note(`${GITHUB_REST} ${minimum} en package.json`);
    }
    return true;
  } };
}

/**
 * The step the repo needs, if any.
 * @param installed - The repo's version, or null.
 * @param latest - The latest on npm, or null.
 * @param root - The repo.
 * @param repair - Whether the flow's doctor finds what `apply` repairs, at the repo's version.
 * @returns The step, or null.
 */
function stepFor(installed: string | null, latest: string | null, root: string, repair: boolean): Step | null {
  if (installed === null && latest !== null) {
    const run = usesApply(latest) ? async (context: Context) => (await applyFlow(context, latest)) && (await moveSkills(context, latest)) : (context: Context) => runFlow(context, latest, ["init", "--yes"]);
    return { piece: NAME, checked: true, downloads: [`${FLOW_PACKAGE}@${latest}`], text: { kind: "flow-install", version: latest }, run };
  }
  if (installed !== null && latest !== null && compareVersions(latest, installed) > 0) {
    const update = (context: Context) => (usesApply(latest) ? applyFlow(context, latest) : runFlow(context, latest, ["upgrade"]));
    return { piece: NAME, checked: true, downloads: [`${FLOW_PACKAGE}@${latest}`], text: { kind: "flow-update", from: installed, to: latest }, run: async (context) => (await update(context)) && (await moveSkills(context, latest)) };
  }
  if (installed !== null && repair)
    return { piece: NAME, checked: true, downloads: [`${FLOW_PACKAGE}@${installed}`], text: { kind: "flow-repair", version: installed }, run: async (context) => (await applyFlow(context, installed)) && (skillsOff(context.root, installed).length === 0 || (await moveSkills(context, installed))) };
  if (installed !== null && skillsOff(root, installed).length > 0)
    return { piece: NAME, checked: true, downloads: [], text: { kind: "flow-skills", version: installed }, run: (context) => moveSkills(context, installed) };
  return null;
}

/**
 * What the repo has of the issue flow, and the step it needs.
 * @param root - The repo.
 * @returns The piece's status.
 * @example (await issueFlowStatus(root)).state // "0.1.0, hay 0.2.0"
 */
export async function issueFlowStatus(root: string): Promise<PieceStatus> {
  const summary = "rama, worktree y PR en draft por issue";
  const spec = flowSpec(root);
  if (spec !== null && !isRelease(spec)) return { name: NAME, summary, installed: true, state: `package.json tiene ${spec}, no una versión exacta; no se toca`, steps: [] };
  const installed = flowVersion(root);
  const latest = await npmLatest(FLOW_PACKAGE);
  const behind = installed !== null && latest !== null && compareVersions(latest, installed) > 0;
  const target = installed === null || behind ? latest : installed;
  const [missing, checks, minimum] = await Promise.all([target === null ? [] : missingLabels(root, target), installed !== null && !behind && usesApply(installed) ? flowDoctor(root, installed, true) : null, target === null ? null : restMinimum(target)]);
  const step = stepFor(installed, latest, root, installed !== null && checks !== null && needsRepair(checks, installed));
  const rest = target === null || minimum === null ? null : restStep(root, target, minimum);
  const known = `${latest === null ? " (npm no responde)" : ""}${missing === null ? " (no se pudieron leer los labels de GitHub)" : ""}`;
  const state = installed === null ? `no instalado${known}` : behind ? `${installed}, hay ${latest}${known}` : `${installed}, al día${known}`;
  const steps = [...(step === null ? [] : [step]), ...(rest === null ? [] : [rest]), ...(target !== null && missing !== null && missing.length > 0 ? [labelsStep(target, missing)] : [])];
  return { name: NAME, summary, installed: installed !== null, state, steps };
}

/**
 * The flow's own doctor at the repo's version, and whether its skills are at that tag.
 * @param root - The repo.
 * @returns The checks.
 * @example (await issueFlowChecks(root))[0].name // "issue-flow: .agents/flow.json"
 */
export async function issueFlowChecks(root: string): Promise<Check[]> {
  const spec = flowSpec(root);
  if (spec === null) return [{ name: NAME, status: "info", detail: "no instalado" }];
  const installed = flowVersion(root);
  if (installed === null) return [{ name: NAME, status: "info", detail: `package.json tiene ${spec}, no una versión exacta` }];
  if (compareVersions(installed, JSON_DOCTOR) < 0) return [{ name: NAME, status: "info", detail: `${installed} no tiene doctor --json: corre npx agent-kitchen apply para actualizarlo` }];
  const labelsRead = missingLabels(root, installed);
  const found = await flowDoctor(root, installed);
  const own: Check[] = found !== null
    ? found.map((check) => ({ name: `${NAME}: ${String(check.name)}`, status: check.ok === true ? "ok" : "fail", detail: String(check.detail) }))
    : [{ name: NAME, status: "fail", detail: `no se pudo correr su doctor; corre 'npx ${FLOW_PACKAGE}@${installed} doctor'` }];
  const off = skillsOff(root, installed);
  const count = catalogSkills(root, FLOW_CATALOG).length;
  const skills: Check = count === 0 && off.length === 0
    ? { name: `${NAME}: skills`, status: "info", detail: "ninguna instalada" }
    : off.length === 0
    ? { name: `${NAME}: skills`, status: "ok", detail: `${count} en v${installed}` }
    : { name: `${NAME}: skills`, status: "fail", detail: `${off.join(", ")}; issue-flow está en ${installed}: corre npx agent-kitchen apply` };
  const missing = await labelsRead;
  const labels: Check[] = compareVersions(installed, LABELS_SINCE) < 0
    ? []
    : missing === null
    ? [{ name: `${NAME}: labels`, status: "info", detail: "no se pudieron leer de GitHub" }]
    : missing.length > 0
    ? [{ name: `${NAME}: labels`, status: "info", detail: `faltan ${missing.join(", ")} en GitHub; corre npx agent-kitchen apply` }]
    : [{ name: `${NAME}: labels`, status: "ok", detail: "GitHub tiene los que espera el flujo" }];
  return [...own, skills, ...labels];
}
