/**
 * @file How a step's progress is shown. Its start says what is happening ("Actualizando…") and
 * its end what is left, with how long it took. In a terminal, a spinner; otherwise plain
 * lines, and a step that takes a while prints how long it has been running, so it does not
 * look stuck (unless the tools print their own output, with `--verbose`).
 */
import { spinner } from "@clack/prompts";
import type { Output } from "./output.js";
import { phrases, ui } from "./texts/index.js";
import type { StepText } from "./texts/step-text.js";

/** How often a plain step says it is still running. */
const TICK_MS = 10_000;

/** How a step's progress is shown. */
export interface Progress {
  start: (text: StepText) => void;
  stop: (text: StepText, ok: boolean) => void;
}

/**
 * The end line of a step.
 * @param text - What the step does.
 * @param ok - Whether it worked.
 * @param ms - How long it took.
 * @returns The line, without the mark.
 */
function endLine(text: StepText, ok: boolean, ms: number): string {
  const said = phrases(text);
  return `${ok ? said.done : ui.failed(said.menu)} (${ui.duration(ms)})`;
}

/**
 * Progress as plain lines: the start, a line now and then while it runs, and the end.
 * @param out - Where to write.
 * @param options - Whether to print while it runs, how often, and the clock.
 * @returns The progress.
 * @example plainProgress(out, { ticks: true }).start({ kind: "guard-adjust" })
 */
export function plainProgress(out: Output, options: { ticks: boolean; tickMs?: number; now?: () => number }): Progress {
  const now = options.now ?? Date.now;
  let started = 0;
  let timer: NodeJS.Timeout | undefined;
  return {
    start: (text) => {
      started = now();
      out.stdout(`${phrases(text).doing}\n`);
      if (options.ticks) timer = setInterval(() => out.stdout(`${ui.still(ui.duration(now() - started))}\n`), options.tickMs ?? TICK_MS);
    },
    stop: (text, ok) => {
      clearInterval(timer);
      timer = undefined;
      out.stdout(`${ok ? "✓" : "✗"} ${endLine(text, ok, now() - started)}\n`);
    },
  };
}

/**
 * How progress is shown: a spinner in a terminal, plain lines otherwise or when `plain` asks
 * for them. Only for the steps, after every question: a spinner shown before a question
 * leaves the second question deaf to the keyboard (@clack/prompts 1.8.1).
 * @param out - Where to write.
 * @param verbose - Whether the tools print on the terminal.
 * @param plain - Whether a question may come after the steps (`--commit`).
 * @returns The progress.
 */
export function progressFor(out: Output, verbose: boolean, plain: boolean): Progress {
  if (out.interactive && !verbose && !plain) {
    const spin = spinner();
    let started = 0;
    return {
      start: (text) => {
        started = Date.now();
        spin.start(phrases(text).doing);
      },
      stop: (text, ok) => {
        const line = endLine(text, ok, Date.now() - started);
        if (ok) spin.stop(line);
        else spin.error(line);
      },
    };
  }
  return plainProgress(out, { ticks: !verbose });
}
