/**
 * The writer behind `core/progress.ts`. Adapter only: it owns a timer and a
 * stream, and decides nothing.
 *
 * On a terminal it redraws one line in place. Off one it prints a plain line on
 * the same heartbeat the gate has always used, because a carriage return in a
 * CI log is a log nobody can read.
 */

import { HEARTBEAT_MS, liveLine, quietLine } from "../core/progress.js";

const ESC = String.fromCharCode(27);
const CR = String.fromCharCode(13);
/** Return to column one and clear to the end: a shorter line must not leave a tail. */
const WIPE = `${CR}${ESC}[2K`;

/** How often the animated frame advances. Slow enough not to strobe. */
const FRAME_MS = 120;

export interface Spinner {
  /** Stop, clear the line, and print what actually happened. */
  stop(finalLine: string): void;
}

export function startSpinner(out: NodeJS.WriteStream, label: string): Spinner {
  const began = Date.now();
  const live = out.isTTY === true;

  if (!live) {
    // The label once, so a log says what started even if it finishes fast.
    out.write(`${quietLine(label, 0)}\n`);
  }

  let frame = 0;
  const beat = setInterval(
    () => {
      const ms = Date.now() - began;
      if (live) out.write(`${WIPE}${liveLine(label, ms, frame++)}`);
      else out.write(`${quietLine(label, ms)}\n`);
    },
    live ? FRAME_MS : HEARTBEAT_MS,
  );
  // So a step that resolves between frames cannot hold the process open.
  beat.unref?.();

  if (live) out.write(`${WIPE}${liveLine(label, 0, 0)}`);

  return {
    stop(finalLine: string): void {
      clearInterval(beat);
      if (live) out.write(WIPE);
      out.write(`${finalLine}\n`);
    },
  };
}
