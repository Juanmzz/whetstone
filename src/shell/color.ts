/**
 * What the terminal on the other end can be sent.
 *
 * The mark degrades rather than switching to a different drawing: 24-bit where
 * the terminal says so, the 256-colour ramp everywhere else, glyphs where there
 * is no colour at all. Every step is the SAME thirty by sixteen pixels in the
 * same eight rows, so the menu below it never moves.
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

  // Not a guess upward. A terminal that has not claimed 24-bit may well not
  // have it (Terminal.app does not, and sets no COLORTERM), and asking for a
  // colour it cannot show gets whichever of its own it decides is nearest.
  return "ansi256";
}
