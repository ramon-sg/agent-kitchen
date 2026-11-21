// Tests of the npm lookups: versions and dependencies come from the registry over HTTP, so a
// machine with no npm gets the same answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installedRepo } from "./helpers.mjs";

// A PATH where `npm` is not there to be used: it exits 127, as a shell does for a missing program.
const withoutNpm = (repo) => {
  const dir = join(repo.tmp, "no-npm");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "npm"), "#!/bin/sh\nexit 127\n");
  chmodSync(join(dir, "npm"), 0o755);
  return `${dir}:${join(repo.tmp, "bin")}:${process.env.PATH}`;
};

test("the latest versions are the same without npm, and npm is never called", () => {
  const repo = installedRepo({ flow: "0.1.0", cloud: "0.9.0" });
  const withNpm = repo.cli(["apply", "--dry-run"]);
  const without = repo.cli(["apply", "--dry-run"], { env: { PATH: withoutNpm(repo) } });

  assert.equal(without.status, 0, without.err);
  assert.match(without.out, /issue-flow +0\.1\.0, hay 0\.2\.0/);
  assert.equal(without.out, withNpm.out);
  assert.deepEqual(repo.npmCalls(), []);
});

test("a package the registry does not have gives no latest version", () => {
  const repo = installedRepo({ flow: "0.1.0" });
  const r = repo.cli(["apply", "--dry-run"], { env: { FAKE_NPM: "{}" } });

  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(r.out, /hay 0\.2\.0/);
  assert.deepEqual(repo.npmCalls(), []);
});

test("lookups use npm_config_registry when AGENT_KITCHEN_REGISTRY is not set", () => {
  const repo = installedRepo({ flow: "0.1.0" });
  const r = repo.cli(["apply", "--dry-run"], { env: { AGENT_KITCHEN_REGISTRY: "", npm_config_registry: repo.registry } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +0\.1\.0, hay 0\.2\.0/);
});

test("AGENT_KITCHEN_REGISTRY wins over npm_config_registry", () => {
  const repo = installedRepo({ flow: "0.1.0" });
  const r = repo.cli(["apply", "--dry-run"], { env: { npm_config_registry: "http://127.0.0.1:9/nope" } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /issue-flow +0\.1\.0, hay 0\.2\.0/);
});
