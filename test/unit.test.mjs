// Unit tests of the pieces that need no repo: comparing versions, and the menu's options
// and keeping own skills (rendering @clack/prompts is not tested; the menus were run by hand in a terminal).
import { test } from "node:test";
import assert from "node:assert/strict";
import { menuOptions, pieceOptions, skillOptions } from "../dist/menu.js";
import { keepOwn, skillsOf } from "../dist/pieces/skills.js";
import { compareVersions } from "../dist/tools.js";
import { guardCommand } from "../dist/pieces/guard.js";

test("versions compare by number, not as text", () => {
  assert.ok(compareVersions("0.10.0", "0.9.1") > 0);
  assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
  assert.equal(compareVersions("2.3.4", "2.3.4"), 0);
});

test("the menu starts with the suggested steps ticked, in the steps' order", () => {
  const steps = [
    { piece: "issue-flow", label: "a", checked: true, run: () => true },
    { piece: "skills", label: "b", checked: false, run: () => true },
    { piece: "claude-cloud", label: "c", checked: true, run: () => true },
  ];

  const { options, initialValues } = menuOptions(steps);

  assert.deepEqual(initialValues, [0, 2]);
  assert.deepEqual(options.map((option) => option.label), ["a", "b", "c"]);
});

test("keeping an own skill also drops the skills that require it, all the way down", () => {
  const candidates = [
    { id: "a/close-pr", name: "close-pr", catalog: "a", description: "", skills: ["close-pr"], requires: ["pr-review-comments"] },
    { id: "a/pr-review-comments", name: "pr-review-comments", catalog: "a", description: "", skills: ["pr-review-comments"], requires: ["github-issues"] },
    { id: "a/github-issues", name: "github-issues", catalog: "a", description: "", skills: ["github-issues"], requires: [] },
    { id: "a/planning", name: "planning", catalog: "a", description: "", skills: ["planning"], requires: [] },
  ];
  const pick = { candidates, picked: candidates.map((candidate) => candidate.id), replace: ["github-issues"] };

  const kept = keepOwn(pick, ["github-issues"]);

  assert.deepEqual(skillsOf(candidates, ["a/close-pr"]).sort(), ["close-pr", "github-issues", "pr-review-comments"]);
  assert.deepEqual(kept.picked, ["a/planning"]);
  assert.deepEqual(kept.replace, []);
});

test("the skills menu groups by catalog and cuts long descriptions", () => {
  const long = "x".repeat(100);

  const groups = skillOptions([
    { id: "a/one", name: "one", catalog: "a", description: long, skills: ["one"], requires: [] },
    { id: "b/two", name: "two", catalog: "b", description: "corta", skills: ["two"], requires: [] },
  ]);

  assert.deepEqual(Object.keys(groups), ["a", "b"]);
  assert.equal(groups.a[0].hint.length, 70);
  assert.equal(groups.b[0].hint, "corta");
});

test("the guard installs with apply from 0.5.0 and on main, with install before", () => {
  assert.equal(guardCommand("0.4.1"), "install");
  assert.equal(guardCommand("0.5.0"), "apply");
  assert.equal(guardCommand("0.10.0"), "apply");
  assert.equal(guardCommand(null), "apply");
});

test("the pieces menu starts with the ticked pieces, in order", () => {
  const { options, initialValues } = pieceOptions(["issue-flow", "claude-repo-guard"], ["issue-flow"]);

  assert.deepEqual(initialValues, ["issue-flow"]);
  assert.deepEqual(options.map((option) => option.label), ["issue-flow", "claude-repo-guard"]);
});

test("noStepsMessage no contradice un archivo de decisiones guardado en la corrida", async () => {
  const { noStepsMessage } = await import("../dist/commands/sync.js");
  assert.equal(noStepsMessage("none", false), "No elegiste nada; no se cambió nada.\n");
  assert.equal(noStepsMessage("leave", false), "No se cambió nada.\n");
  assert.equal(noStepsMessage("none", true), "No elegiste pasos; solo guardé qué piezas usa el repo.\n");
  assert.equal(noStepsMessage("leave", true), "No corrí ningún paso; solo guardé qué piezas usa el repo.\n");
});

test("the commit of --commit names the saved decisions next to the steps that ran", async () => {
  const { commitLabels } = await import("../dist/commands/sync.js");
  const saved = "Guardar qué piezas usa el repo en .agents/kitchen.json";

  assert.deepEqual(commitLabels([], true), [saved]);
  assert.deepEqual(commitLabels(["Instalar issue-flow 0.2.0"], true), ["Instalar issue-flow 0.2.0", saved]);
  assert.deepEqual(commitLabels(["Instalar issue-flow 0.2.0"], false), ["Instalar issue-flow 0.2.0"]);
  assert.deepEqual(commitLabels([], false), []);
});
