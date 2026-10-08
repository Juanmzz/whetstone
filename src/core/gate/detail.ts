/**
 * What a failing check printed, cut down to what an agent can act on. PURE.
 *
 * The tail, because compilers and test runners put the verdict last. Lines rather
 * than characters, because a cut through the middle of a line is how a report ends
 * up holding half a stack frame and no test name.
 */

const MAX_LINES = 40;
const MAX_LINE_CHARS = 400;
const MAX_CHARS = 4000;

const ESC = "\\u001b";
const BEL = "\\u0007";
/** CSI (colours, cursor moves) and OSC (hyperlinks, titles). */
const ANSI = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\))`, "g");

/** node prints `at`, vitest prints `❯`. Either way the frame is somebody else's code. */
const DEPENDENCY_FRAME = /^\s*(?:at|❯)\s.*node_modules[\\/]/;

const cut = (line: string): string =>
  line.length <= MAX_LINE_CHARS ? line : `${line.slice(0, MAX_LINE_CHARS)}…`;

export function failureLines(text: string): string[] {
  const meaningful = text
    .replace(ANSI, "")
    .split(/\r?\n/)
    // A carriage return redraws the line, so only what follows the last one was left on screen.
    .map((line) => line.slice(line.lastIndexOf("\r") + 1).trimEnd())
    .filter((line) => line.trim() !== "" && !DEPENDENCY_FRAME.test(line))
    .map(cut);

  const kept: string[] = [];
  let size = 0;
  for (let i = meaningful.length - 1; i >= 0 && kept.length < MAX_LINES; i--) {
    const line = meaningful[i] ?? "";
    const grown = size + line.length + (kept.length === 0 ? 0 : 1);
    if (kept.length > 0 && grown > MAX_CHARS) break;
    kept.unshift(line);
    size = grown;
  }

  const omitted = meaningful.length - kept.length;
  if (omitted === 0) return kept;
  return [`… ${String(omitted)} earlier line${omitted === 1 ? "" : "s"} not shown`, ...kept];
}
