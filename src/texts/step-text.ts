/**
 * @file What a step does, as data: its kind, the piece's versions and what it brings. No
 * words here; each place that shows a step (the menu, the start and end of its progress, the
 * commit) turns this into its own text, so the interface can change language without the
 * commits changing too.
 */

/** A version that may be unknown (`null`), shown as `?` or as the place it comes from. */
type MaybeVersion = string | null;

/** What a step does, one kind per thing a piece can offer. */
export type StepText =
  | { kind: "skills-manager-create"; version: string }
  | { kind: "skills-manager-add"; version: string }
  | { kind: "skills-manager-bump"; from: string; to: string }
  | { kind: "flow-install"; version: string }
  | { kind: "flow-update"; from: string; to: string }
  | { kind: "flow-repair"; version: string }
  | { kind: "flow-skills"; version: string }
  | { kind: "flow-labels"; missing: string[] }
  | { kind: "github-rest-bump"; from: string; to: string; flow: string }
  | { kind: "cloud-install"; version: MaybeVersion }
  | { kind: "cloud-update"; from: MaybeVersion; to: string; config: string }
  | { kind: "guard-install"; version: MaybeVersion }
  | { kind: "guard-update"; from: MaybeVersion; to: string }
  | { kind: "guard-adjust" }
  | { kind: "skills-install"; count: number; catalogs: string[] }
  | { kind: "skills-update"; catalog: string; from: string; to: string; names: string[] }
  | { kind: "skills-add"; names: string[] }
  | { kind: "agents-md"; rule: boolean; claudeImport: boolean }
  | { kind: "install-deps"; manager: string };

/** The kinds of step. */
export type StepKind = StepText["kind"];

/** The data of one kind of step. */
export type StepOf<K extends StepKind> = Extract<StepText, { kind: K }>;
