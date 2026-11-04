/**
 * @file The language of the terminal: `--lang`, then `AGENT_KITCHEN_LANG`, then Spanish.
 * `LANG` and `LC_ALL` are not read: on macOS they often say English for people who speak Spanish.
 */
import { UsageError } from "./output.js";

/** A language the terminal speaks. */
export type Lang = "es" | "en";

/** The variable that picks the language when `--lang` is not given. */
export const LANG_VAR = "AGENT_KITCHEN_LANG";

/** A `--lang` or `AGENT_KITCHEN_LANG` value that is neither `es` nor `en`. */
export class LangError extends UsageError {
  /**
   * @param source - Where the value came from (`--lang` or `AGENT_KITCHEN_LANG`).
   * @param value - The value.
   */
  constructor(
    readonly source: string,
    readonly value: string,
  ) {
    super(`${source}: ${value}`);
  }
}

/**
 * Whether a value is a language.
 * @param value - The value.
 * @returns True for `es` and `en`.
 */
function isLang(value: string): value is Lang {
  return value === "es" || value === "en";
}

/**
 * The `--lang` value in the arguments, read before parsing them, so even an error of the
 * arguments is said in the language asked for.
 * @param argv - The arguments.
 * @returns The value, or undefined if there is none.
 * @example langFlag(["apply", "--lang", "en"]) // "en"
 */
export function langFlag(argv: string[]): string | undefined {
  let found: string | undefined;
  for (const [index, arg] of argv.entries()) {
    if (arg === "--") break;
    if (arg === "--lang") found = argv[index + 1] ?? "";
    else if (arg.startsWith("--lang=")) found = arg.slice("--lang=".length);
  }
  return found;
}

/**
 * The language of the terminal.
 * @param flag - The `--lang` value, or undefined.
 * @param env - The environment.
 * @returns The language: the flag, else `AGENT_KITCHEN_LANG` (empty counts as unset), else `es`.
 * @throws LangError if the value is neither `es` nor `en`.
 * @example resolveLang(undefined, { AGENT_KITCHEN_LANG: "en" }) // "en"
 */
export function resolveLang(flag: string | undefined, env: NodeJS.ProcessEnv): Lang {
  const fromEnv = env[LANG_VAR]?.trim() === "" ? undefined : env[LANG_VAR];
  const source = flag !== undefined ? "--lang" : LANG_VAR;
  const value = flag ?? fromEnv;
  if (value === undefined) return "es";
  const lang = value.trim().toLowerCase();
  if (!isLang(lang)) throw new LangError(source, value);
  return lang;
}
