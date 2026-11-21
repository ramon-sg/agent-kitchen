// Tests of the published package: what `npm pack` puts in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the package has the compiled CLI, and no tests nor sources", () => {
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8" }));
  const files = pack.files.map((file) => file.path);

  for (const file of ["dist/cli.js", "package.json", "README.md", "LICENSE"]) assert.ok(files.includes(file), `${file} is not in the package`);
  assert.deepEqual(files.filter((file) => file.startsWith("test/") || file.startsWith("src/")), []);
});

test("the published package.json has no dependencies: they are bundled in dist/cli.js", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
});
