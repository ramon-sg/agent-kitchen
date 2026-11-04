#!/usr/bin/env node
/**
 * @file Entry point of `agent-kitchen`: parses the arguments and runs the command. Before
 * that, if npm has a newer agent-kitchen than the one running (npx may run an old copy from
 * its cache), it runs that one instead with the same arguments. The terminal speaks the
 * language of `--lang`, else `AGENT_KITCHEN_LANG`, else Spanish. Usage errors exit 2 with
 * the usage text; errors of the repo exit 1 with their message, in a block with Kuro.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { show } from "./banner.js";
import { doctor } from "./commands/doctor.js";
import { pieceNames, sync } from "./commands/sync.js";
import { langFlag, LangError, resolveLang } from "./lang.js";
import { KitError, type Output, processOutput, UsageError } from "./output.js";
import { FLOW_PACKAGE, GENERAL_CATALOGS } from "./piece.js";
import { PACKAGE as CLOUD_PACKAGE } from "./pieces/cloud.js";
import { REPO as GUARD_REPO } from "./pieces/guard.js";
import { ui, useLang } from "./texts/index.js";
import { compareVersions, isRelease, latestTag, npmLatest, npmLatestExact } from "./tools.js";

/** This package on npm. */
const PACKAGE = "agent-kitchen";

/** Set in the run that a newer agent-kitchen was handed to, so it never hands over again. */
const HANDED_OVER = "AGENT_KITCHEN_HANDED_OVER";

/**
 * This package's version.
 * @returns The version in its package.json.
 */
function ownVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
  return pkg.version ?? "unknown";
}

/**
 * Starts the lookups of the latest versions, so they run while this one checks its own.
 */
function startLookups(): void {
  void npmLatest(FLOW_PACKAGE);
  void npmLatestExact(CLOUD_PACKAGE);
  void latestTag(GUARD_REPO);
  for (const catalog of GENERAL_CATALOGS) void latestTag(catalog);
}

/**
 * Runs the latest agent-kitchen with the same arguments, if npm has one newer than this.
 * @param argv - The arguments.
 * @returns Its exit code, or null if this one is the latest or npm cannot tell.
 */
async function handOver(argv: string[]): Promise<number | null> {
  const own = ownVersion();
  if (process.env[HANDED_OVER] !== undefined || !isRelease(own)) return null;
  const latest = await npmLatest(PACKAGE);
  if (latest === null || compareVersions(latest, own) <= 0) return null;
  process.stderr.write(`${ui.cli.handOver(latest, own)}\n`);
  const result = spawnSync("npx", ["--yes", `${PACKAGE}@${latest}`, ...argv], { stdio: "inherit", env: { ...process.env, [HANDED_OVER]: own } });
  return result.status ?? 1;
}

/**
 * The usage text, in the interface's language.
 * @returns The text.
 */
function usage(): string {
  return ui.cli.usage(pieceNames());
}

/**
 * Runs the CLI. The language is settled first, from `--lang` or `AGENT_KITCHEN_LANG`.
 * @param argv - The arguments, without node and the script.
 * @param out - Where to write.
 * @returns The exit code.
 * @throws UsageError for unknown arguments or an unknown language; KitError from the command.
 */
async function main(argv: string[], out: Output): Promise<number> {
  useLang(resolveLang(langFlag(argv), process.env));
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { yes: { type: "boolean" }, "dry-run": { type: "boolean" }, commit: { type: "boolean" }, pr: { type: "boolean" }, here: { type: "boolean" }, verbose: { type: "boolean", short: "v" }, skip: { type: "string" }, pieces: { type: "boolean" }, lang: { type: "string" }, help: { type: "boolean", short: "h" }, version: { type: "boolean" } },
  });
  if (values.help === true) {
    out.stdout(`${usage()}\n`);
    return 0;
  }
  if (values.version === true) {
    out.stdout(`${ownVersion()}\n`);
    return 0;
  }
  startLookups();
  const handed = await handOver(argv);
  if (handed !== null) return handed;
  const [command, ...rest] = positionals;
  if (rest.length > 0 || (command !== undefined && command !== "doctor" && command !== "apply")) throw new UsageError(ui.cli.noCommand(positionals.join(" ")));
  if (command === "doctor") {
    if (values.yes !== undefined || values["dry-run"] !== undefined || values.skip !== undefined || values.verbose !== undefined || values.commit !== undefined || values.pr !== undefined || values.here !== undefined || values.pieces !== undefined) throw new UsageError(ui.cli.doctorNoOptions);
    return doctor(process.cwd(), out);
  }
  if (values.commit !== undefined) throw new UsageError(ui.cli.commitGone);
  if (command === undefined) out.stderr(`${ui.cli.bare}\n`);
  const skip = (values.skip ?? "").split(",").map((name) => name.trim()).filter((name) => name !== "");
  return sync({ cwd: process.cwd(), yes: values.yes ?? false, dryRun: values["dry-run"] ?? false, verbose: values.verbose ?? false, skip, pr: values.pr ?? false, here: values.here ?? false, pieces: values.pieces ?? false }, out);
}

const out = processOutput();
try {
  process.exitCode = await main(process.argv.slice(2), out);
} catch (error) {
  if (error instanceof UsageError || (error instanceof TypeError && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS"))) {
    const message = error instanceof LangError ? ui.cli.lang(error.source, error.value) : error.message;
    process.stderr.write(`agent-kitchen: ${message}\n\n${usage()}\n`);
    process.exitCode = 2;
  } else if (error instanceof KitError) {
    show(out, { mood: "error", title: ui.cli.stopped, lines: error.message.split("\n") }, process.cwd(), "stderr");
    process.exitCode = 1;
  } else {
    throw error;
  }
}
