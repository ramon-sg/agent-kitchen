// Tests of the final-message block: Kuro, the layout, color and the `art` switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { banner, blockOpts, KURO } from "../dist/banner.js";
import { makeRepo } from "./helpers.mjs";

const DONE = {
  mood: "ok",
  title: "Listo.",
  lines: ["Falta: revisa el diff y haz commit."],
  next: { label: "Siguiente paso para la nube:", command: "npx agent-cloud-kit prepare" },
};

test("KURO is the drawing of issue-flow's issue #49, byte for byte", () => {
  assert.equal(
    KURO.join("\n"),
    ["    ▄█████▄", " ≋≋██▀▀▀▀▀██", "    █ ▄  ▄ █   ╱", "    ▀█▄▄▄▄█▀  ╱"].join("\n"),
  );
});

test("with art, the block is Kuro on the left and the text from row 1 at column 26", () => {
  // Written out literally, so a bug in the layout code cannot hide in both sides.
  const literal =
    "\n" +
    "    ▄█████▄\n" +
    " ≋≋██▀▀▀▀▀██" + " ".repeat(14) + "[ok] Listo.\n" +
    "    █ ▄  ▄ █   ╱\n" +
    "    ▀█▄▄▄▄█▀  ╱" + " ".repeat(11) + "Falta: revisa el diff y haz commit.\n" +
    "\n" +
    "                          Siguiente paso para la nube:\n" +
    "                            npx agent-cloud-kit prepare\n" +
    "\n";

  assert.equal(banner(DONE, { art: true, color: false }), literal);
});

test("without art there is no drawing, and the text is indented by two", () => {
  assert.equal(
    banner(DONE, { art: false, color: false }),
    "\n  [ok] Listo.\n\n  Falta: revisa el diff y haz commit.\n\n  Siguiente paso para la nube:\n    npx agent-cloud-kit prepare\n\n",
  );
});

test("rows are aligned, and a long value stays whole", () => {
  const url = `https://github.com/o/r/pull/${"7".repeat(100)}`;
  const text = banner({ mood: "ok", title: "PR en draft abierto.", rows: [["PR", url], ["Rama", "x"]] }, { art: false, color: false });

  assert.ok(text.includes(`  PR    ${url}\n  Rama  x\n`));
});

test("color only shows up when asked, and each mood has its mark", () => {
  assert.ok(!banner(DONE, { art: true, color: false }).includes("\x1b"));
  const colored = banner(DONE, { art: true, color: true });
  assert.ok(colored.includes("\x1b[32m[ok]"));
  assert.ok(colored.includes("\x1b[1mnpx agent-cloud-kit prepare"));
  assert.ok(banner({ mood: "error", title: "x" }, { art: false, color: true }).includes("\x1b[31m[!]"));
  assert.ok(banner({ mood: "question", title: "x" }, { art: false, color: false }).includes("[?] x"));
});

test("Kuro needs a terminal and is off with art: false in kitchen.json or flow.json; color needs NO_COLOR unset", () => {
  const repo = makeRepo();
  const out = (stdout, stderr) => ({ terminal: { stdout, stderr } });
  const saved = process.env.NO_COLOR;
  try {
    delete process.env.NO_COLOR;
    assert.deepEqual(blockOpts(out(true, false), "stdout", repo.main), { art: true, color: true });
    assert.deepEqual(blockOpts(out(true, false), "stderr", repo.main), { art: false, color: false });
    assert.deepEqual(blockOpts({}, "stdout", null), { art: false, color: false });
    repo.write(".agents/flow.json", { art: false });
    assert.deepEqual(blockOpts(out(true, true), "stdout", repo.main), { art: false, color: true });
    repo.write(".agents/flow.json", {});
    repo.write(".agents/kitchen.json", { art: false, pieces: {} });
    assert.equal(blockOpts(out(true, true), "stdout", repo.main).art, false);
    repo.write(".agents/kitchen.json", "{ broken");
    assert.equal(blockOpts(out(true, true), "stdout", repo.main).art, true);
    process.env.NO_COLOR = "1";
    assert.equal(blockOpts(out(true, true), "stdout", null).color, false);
  } finally {
    if (saved === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = saved;
  }
});
