/**
 * @file `agent-kitchen doctor`: whether each piece the repo has works, with the doctor of each
 * tool at the repo's own version: the version of skills-manager agent-kitchen needs, the
 * issue flow (and its skills at its tag),
 * `skills-manager check`, the version `.claude/cloud.json` pins, and claude-repo-guard. It
 * changes nothing. A piece the repo does not have, or a newer release, is only noted, and so is
 * a missing rule in AGENTS.md. A piece the repo decided against (`.agents/kitchen.json`) is
 * only noted, and its tool is not asked.
 */
import { readDecisions } from "../decisions.js";
import { type Output, warn } from "../output.js";
import type { Check } from "../piece.js";
import { agentsMdChecks, NAME as AGENTS_MD } from "../pieces/agents-md.js";
import { cloudChecks, NAME as CLOUD } from "../pieces/cloud.js";
import { guardChecks, NAME as GUARD } from "../pieces/guard.js";
import { issueFlowChecks, NAME as FLOW } from "../pieces/issue-flow.js";
import { NAME as SKILLS, skillsChecks } from "../pieces/skills.js";
import { skillsManagerChecks } from "../pieces/skills-manager.js";
import { mainCheckout } from "../repo.js";

/** The mark of each check's status. */
const MARKS: Record<Check["status"], string> = { ok: "✓", fail: "✗", info: "·" };

/**
 * Checks the repo; see the file's header.
 * @param cwd - Where it runs.
 * @param out - Where to write.
 * @returns 0 if nothing failed, 1 if something did.
 * @throws KitError outside a checkout or with a broken file.
 * @example await doctor(process.cwd(), out)
 */
export async function doctor(cwd: string, out: Output): Promise<number> {
  const root = mainCheckout(cwd, "agent-kitchen doctor");
  const saved = readDecisions(root);
  for (const warning of saved?.warnings ?? []) warn(out, warning);
  /** The checks of a piece, or a note if the repo left it out. */
  const unless = (name: string, run: () => Promise<Check[]>): Promise<Check[]> =>
    saved?.pieces[name] === false ? Promise.resolve([{ name, status: "info", detail: "fuera por decisión del repo" }]) : run();
  const checks = (await Promise.all([skillsManagerChecks(root), unless(FLOW, () => issueFlowChecks(root)), unless(SKILLS, () => skillsChecks(root)), unless(CLOUD, () => cloudChecks(root)), unless(GUARD, () => guardChecks(root)), unless(AGENTS_MD, () => agentsMdChecks(root))])).flat();
  for (const check of checks) out.stdout(`${MARKS[check.status]} ${check.name}: ${check.detail}\n`);
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}
