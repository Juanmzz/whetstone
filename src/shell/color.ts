/**
 * What the terminal on the other end can be sent. The mark DEGRADES rather than
 * switching drawing, so every step is the same pixels in the same rows and the
 * menu below never moves.
 */

import type { ColorDepth } from "../core/tui/mark.js";

export function colorDepth(
  isTTY: boolean,
  env: Record<string, string | undefined>,
): ColorDepth {
  if (!isTTY) return "none";
  // no-color.org: any value, presence is the whole signal.
  if (env["NO_COLOR"] !== undefined) return "none";
  if (env["TERM"] === "dumb") return "none";

  const flag = (env["COLORTERM"] ?? "").toLowerCase();
  if (flag === "truecolor" || flag === "24bit") return "truecolor";

  // Never guess upward: Terminal.app has colour, has no truecolor, and sets no
  // COLORTERM.
  return "ansi256";
}
