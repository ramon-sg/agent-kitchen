// Tests of the texts of a step and of its progress: every kind of step has its texts in the
// catalog, the start says what is happening and the end what is left with how long it took,
// and a step that takes a while says it is still running.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { es } from "../dist/texts/es.js";
import { phrasesIn } from "../dist/texts/index.js";
import { plainProgress } from "../dist/progress.js";
import { commitLine } from "../dist/commit-texts.js";

// One step of each kind; a kind added to StepText without a sample here fails the first test.
const SAMPLES = [
  { kind: "skills-manager-create", version: "1.2.0" },
  { kind: "skills-manager-add", version: "1.2.0" },
  { kind: "skills-manager-bump", from: "1.1.0", to: "1.2.0" },
  { kind: "flow-install", version: "0.3.0" },
  { kind: "flow-update", from: "0.2.7", to: "0.3.0" },
  { kind: "flow-repair", version: "0.3.0" },
  { kind: "flow-skills", version: "0.3.0" },
  { kind: "flow-labels", missing: ["spike"] },
  { kind: "github-rest-bump", from: "0.2.1", to: "0.3.0", flow: "0.3.0" },
  { kind: "cloud-install", version: null },
  { kind: "cloud-update", from: "1.0.0", to: "1.1.0", config: ".claude/cloud.json" },
  { kind: "guard-install", version: "0.5.0" },
  { kind: "guard-update", from: null, to: "0.5.1" },
  { kind: "guard-adjust" },
  { kind: "skills-install", count: 6, catalogs: ["ramon-sg/issue-flow", "ramon-sg/agent-skills"] },
  { kind: "skills-update", catalog: "ramon-sg/agent-skills", from: "v0.1.0", to: "0.2.0", names: ["code-audit"] },
  { kind: "skills-add", names: ["planning"] },
  { kind: "agents-md", rule: true, claudeImport: true },
  { kind: "install-deps", manager: "npm" },
];

// An output that keeps what it is given.
const captured = () => {
  const lines = [];
  return { lines, out: { stdout: (text) => lines.push(text), stderr: (text) => lines.push(text), interactive: false } };
};

test("every kind of step has a sample here and its texts in es", () => {
  assert.deepEqual(SAMPLES.map((sample) => sample.kind).sort(), Object.keys(es.steps).sort());
});

test("each step orders in the menu, says what it is doing without an arrow in front, and what is left", () => {
  for (const sample of SAMPLES) {
    const said = phrasesIn(es, sample);
    assert.match(said.doing, /^[A-Z][a-zá-ú]+ndo .+…$/, sample.kind);
    assert.doesNotMatch(said.doing, /→/, sample.kind);
    assert.doesNotMatch(said.done, /→|…$/, sample.kind);
    assert.notEqual(said.menu, said.done, sample.kind);
  }
});

test("the commit reads a step in Spanish, whatever the interface shows", () => {
  assert.equal(commitLine({ kind: "flow-update", from: "0.2.7", to: "0.3.0" }), "Actualizar issue-flow 0.2.7 → 0.3.0, con sus hooks y sus skills");
});

test("durations are short and in Spanish", () => {
  assert.equal(es.duration(420), "0,4 s");
  assert.equal(es.duration(12_400), "12 s");
  assert.equal(es.duration(65_000), "1 min 5 s");
  assert.equal(es.duration(120_000), "2 min");
});

test("a plain step prints its start, says it is still running while it takes, and stops saying so at the end", async () => {
  const { lines, out } = captured();
  let clock = 0;
  const progress = plainProgress(out, { ticks: true, tickMs: 10, now: () => clock });
  const step = { kind: "flow-update", from: "0.2.7", to: "0.3.0" };

  progress.start(step);
  clock = 12_000;
  // Real timers: wait for two ticks, however busy the machine is.
  for (let waited = 0; lines.length < 3 && waited < 2000; waited += 5) await sleep(5);
  progress.stop(step, true);
  const count = lines.length;
  await sleep(30);

  assert.equal(lines[0], "◒ Actualizando issue-flow de 0.2.7 a 0.3.0…\n");
  assert.ok(lines.slice(1, -1).length >= 2, lines.join(""));
  for (const line of lines.slice(1, -1)) assert.equal(line, "  … sigue (12 s)\n");
  assert.equal(lines.at(-1), "✓ issue-flow actualizado de 0.2.7 a 0.3.0, con sus hooks y sus skills (12 s)\n");
  assert.equal(lines.length, count);
});

test("a failed step ends with its order and how long it took; with the tools' output shown it does not tick", async () => {
  const { lines, out } = captured();
  const progress = plainProgress(out, { ticks: false, tickMs: 5, now: () => 0 });
  const step = { kind: "guard-adjust" };

  progress.start(step);
  await sleep(25);
  progress.stop(step, false);

  assert.deepEqual(lines, ["◒ Ajustando claude-repo-guard al flujo de issues…\n", "✗ Falló: Ajustar claude-repo-guard a lo que necesita el flujo de issues (0,0 s)\n"]);
});
