// Tests of the language of the terminal: `--lang`, then AGENT_KITCHEN_LANG, then Spanish; both
// catalogs with the same keys; and what is written into the repo (commit, PR) stays in Spanish.
import { test } from "node:test";
import assert from "node:assert/strict";
import { langFlag, resolveLang } from "../dist/lang.js";
import { en } from "../dist/texts/en.js";
import { es } from "../dist/texts/es.js";
import { phrasesIn, useLang } from "../dist/texts/index.js";
import { commitLine } from "../dist/commit-texts.js";
import { installedRepo, makeRepo } from "./helpers.mjs";

// Every key of a catalog, as dotted paths, down to its texts and functions.
const keys = (value, prefix = "") =>
  Object.entries(value).flatMap(([key, item]) => (typeof item === "object" && item !== null ? keys(item, `${prefix}${key}.`) : [`${prefix}${key}`])).sort();

test("the language is the flag, else AGENT_KITCHEN_LANG, else Spanish; LANG is not read", () => {
  assert.equal(resolveLang(undefined, {}), "es");
  assert.equal(resolveLang(undefined, { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" }), "es");
  assert.equal(resolveLang(undefined, { AGENT_KITCHEN_LANG: "en" }), "en");
  assert.equal(resolveLang(undefined, { AGENT_KITCHEN_LANG: " " }), "es");
  assert.equal(resolveLang("es", { AGENT_KITCHEN_LANG: "en" }), "es");
  assert.equal(resolveLang("EN", {}), "en");
  assert.throws(() => resolveLang("fr", {}), (error) => error.source === "--lang" && error.value === "fr");
  assert.throws(() => resolveLang(undefined, { AGENT_KITCHEN_LANG: "pt" }), (error) => error.source === "AGENT_KITCHEN_LANG");
});

test("--lang is found before the arguments are parsed, in both of its forms", () => {
  assert.equal(langFlag(["apply", "--lang", "en"]), "en");
  assert.equal(langFlag(["--lang=en", "doctor"]), "en");
  assert.equal(langFlag(["apply", "--lang"]), "");
  assert.equal(langFlag(["apply"]), undefined);
  assert.equal(langFlag(["--", "--lang", "en"]), undefined);
});

test("both catalogs have the same keys, every kind of step included", () => {
  assert.deepEqual(keys(en), keys(es));
});

test("in English each step orders, says what it is doing and what is left", () => {
  for (const [kind, render] of Object.entries(en.steps)) {
    const said = render({ kind, version: "1.0.0", from: "1.0.0", to: "1.1.0", flow: "0.3.0", config: ".claude/cloud.json", missing: ["spike"], count: 2, catalogs: ["a/b"], catalog: "a/b", names: ["x"], rule: true, claudeImport: false, manager: "npm" });
    assert.match(said.doing, /^[A-Z][a-z]+ing .+…$/, kind);
    assert.doesNotMatch(said.done, /→|…$/, kind);
    assert.notEqual(said.menu, said.done, kind);
  }
});

test("the commit stays in Spanish when the interface speaks English", () => {
  useLang("en");
  try {
    assert.equal(commitLine({ kind: "flow-install", version: "0.2.0" }), phrasesIn(es, { kind: "flow-install", version: "0.2.0" }).menu);
  } finally {
    useLang("es");
  }
});

test("--help speaks the language asked for", () => {
  const repo = makeRepo();

  assert.match(repo.cli(["--help"]).out, /^Uso:/);
  assert.match(repo.cli(["--help", "--lang", "en"]).out, /^Usage:/);
  assert.match(repo.cli(["--help"], { env: { AGENT_KITCHEN_LANG: "en" } }).out, /^Usage:/);
  assert.match(repo.cli(["--help", "--lang", "es"], { env: { AGENT_KITCHEN_LANG: "en" } }).out, /^Uso:/);
});

test("an unknown language is a usage error that names the valid ones", () => {
  const repo = makeRepo();

  const flag = repo.cli(["apply", "--lang", "fr"]);
  const env = repo.cli(["doctor"], { env: { AGENT_KITCHEN_LANG: "pt" } });

  assert.equal(flag.status, 2);
  assert.match(flag.err, /--lang espera es o en: fr/);
  assert.match(flag.err, /Uso:/);
  assert.equal(env.status, 2);
  assert.match(env.err, /AGENT_KITCHEN_LANG espera es o en: pt/);
});

test("apply and doctor speak English with AGENT_KITCHEN_LANG=en, and end in a block", () => {
  const repo = installedRepo({ cloud: "1.0.0" });

  const dry = repo.cli(["apply", "--dry-run"], { env: { AGENT_KITCHEN_LANG: "en" } });
  const applied = repo.cli(["apply", "--yes", "--lang", "en"]);
  const doctor = repo.cli(["doctor", "--lang", "en"]);

  assert.equal(dry.status, 0, dry.err);
  assert.match(dry.out, /This repo has:/);
  assert.match(dry.out, /agent-cloud-kit +1\.0\.0, 1\.1\.0 is out/);
  assert.match(dry.out, /\[x\] Update agent-cloud-kit 1\.0\.0 → 1\.1\.0/);
  assert.equal(applied.status, 0, applied.err);
  assert.match(applied.out, /✓ agent-cloud-kit updated from 1\.0\.0 to 1\.1\.0/);
  assert.match(applied.out, /\[ok\] Done\.\n\n  Left to do: review the diff and commit\.\n\n  Next step for the cloud:\n    npx agent-cloud-kit prepare\n/);
  assert.doesNotMatch(applied.out + doctor.out, /[áéíóú]|Listo|Falta/);
  assert.match(doctor.out, /✓ agent-cloud-kit: 1\.1\.0/);
  assert.match(doctor.out, /\[ok\] No check failed\.\n/);
});

test("doctor ends saying how many checks failed", () => {
  const repo = installedRepo({ cloud: "1.0.0" });
  repo.write(".claude/cloud.json", { version: "latest" });

  const r = repo.cli(["doctor"]);

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ agent-cloud-kit: \.claude\/cloud\.json no fija una versión exacta/);
  assert.match(r.out, /\[!\] Falló 1 revisión\.\n/);
});

test("an error that stops the command is a block on stderr, in the language asked for", () => {
  const repo = makeRepo();
  repo.write(".agents/kitchen.json", "{ not json");

  const es = repo.cli(["doctor"]);
  const en = repo.cli(["doctor", "--lang", "en"]);

  assert.equal(es.status, 1);
  assert.match(es.err, /^\n  \[!\] No pude seguir\n\n  \.agents\/kitchen\.json no es JSON válido/);
  assert.equal(en.status, 1);
  assert.match(en.err, /\[!\] Could not go on\n\n  \.agents\/kitchen\.json is not valid JSON/);
});
