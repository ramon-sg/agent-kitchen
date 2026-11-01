// Tests of the per-piece decisions module: reading, deciding, writing .agents/kitchen.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DECIDABLE, decide, off, readDecisions, undecided, writeDecisions } from "../dist/decisions.js";

const step = (piece) => ({ piece, label: piece, checked: true, downloads: [], run: async () => true });
const status = (name, installed, steps = []) => ({ name, summary: "", installed, state: "", steps });

test("decide: installed pieces and chosen steps are wanted, offered but unchosen are not", () => {
  const result = decide(
    [
      status("issue-flow", true),
      status("claude-cloud", false, [step("claude-cloud")]),
      status("skills", false, [step("skills")]),
      status("agents-md", true, [step("agents-md")]),
      status("claude-repo-guard", true),
      status("skills-manager", true, [step("skills-manager")]),
    ],
    [step("claude-cloud")],
    { "claude-repo-guard": false },
  );

  assert.deepEqual(result, {
    "claude-repo-guard": false,
    "issue-flow": true,
    "claude-cloud": true,
    skills: false,
    "agents-md": true,
  });
});

test("decide: a not installed piece without steps gets no decision", () => {
  assert.deepEqual(decide([status("skills", false)], [], {}), {});
});

test("readDecisions: no file is null; unknown, skills-manager and non-boolean values are left out", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-decisions-"));
  assert.equal(readDecisions(root), null);

  mkdirSync(join(root, ".agents"));
  writeFileSync(
    join(root, ".agents/kitchen.json"),
    JSON.stringify({ pieces: { "claude-repo-guard": false, "claude-x": true, "skills-manager": true, skills: "no" } }),
  );
  const saved = readDecisions(root);

  assert.deepEqual(saved.pieces, { "claude-repo-guard": false });
  assert.equal(saved.warnings.length, 1);
  assert.match(saved.warnings[0], /skills/);
});

test("writeDecisions keeps the other keys and adds the new decisions", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-decisions-"));
  mkdirSync(join(root, ".agents"));
  const raw = { otra: 1, pieces: { "claude-x": true } };

  writeDecisions(root, { "issue-flow": true }, raw);

  assert.deepEqual(JSON.parse(readFileSync(join(root, ".agents/kitchen.json"), "utf8")), {
    otra: 1,
    pieces: { "claude-x": true, "issue-flow": true },
  });
});

test("undecided and off", () => {
  assert.deepEqual(undecided(null), DECIDABLE);
  assert.equal(DECIDABLE.length, 5);
  const saved = { pieces: { "issue-flow": true, skills: false }, raw: {}, warnings: [] };
  assert.deepEqual(off(saved), ["skills"]);
  assert.deepEqual(undecided(saved), ["claude-cloud", "claude-repo-guard", "agents-md"]);
  assert.deepEqual(off(null), []);
});
