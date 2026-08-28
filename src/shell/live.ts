/**
 * The bottom line of the terminal, owned by ONE writer.
 *
 * The gate runs its checks concurrently. A spinner per check was tried and
 * reverted, because there is no single line for three of them to rewrite. This
 * is that single line: whatever is in flight, redrawn in place, with results
 * printed above it as they land.
 *
 * Off a terminal it degrades to the lines the gate has always printed: one when
 * a check starts, one every ten seconds while it runs.
 */

import { HEARTBEAT_MS, runningLine } from "../core/progress.js";

const ESC = String.fromCharCode(27);
const CR = String.fromCharCode(13);
const WIPE = `${CR}${ESC}[2K`;
const FRAME_MS = 120;

export interface Live {
  /** A check began. */
  add(id: string): void;
  /** It ended: its result goes above the live line. */
  done(id: string, line: string): void;
  close(): void;
}

/** Prints, keeps no line, animates nothing. For `--json` and for a pipe. */
function plain(out: NodeJS.WriteStream, quiet: boolean, running: Map<string, number>): Live {
  const beat = setInterval(() => {
    if (quiet) return;
    for (const [id, began] of running) {
      out.write(`  ${"...".padEnd(8)} ${id.padEnd(14)} (${((Date.now() - began) / 1000).toFixed(1)}s)\n`);
    }
  }, HEARTBEAT_MS);
  beat.unref?.();

  return {
    add(id) {
      running.set(id, Date.now());
      if (!quiet) out.write(`  running  ${id}\n`);
    },
    done(id, line) {
      running.delete(id);
      if (!quiet && line !== "") out.write(`${line}\n`);
    },
    close() {
      clearInterval(beat);
    },
  };
}

export function startLive(out: NodeJS.WriteStream, quiet: boolean): Live {
  const running = new Map<string, number>();
  if (quiet || out.isTTY !== true) return plain(out, quiet, running);

  let frame = 0;
  const draw = (): void => {
    const oldest = Math.min(...[...running.values()], Date.now());
    out.write(`${WIPE}${runningLine([...running.keys()], Date.now() - oldest, frame++)}`);
  };

  const beat = setInterval(draw, FRAME_MS);
  beat.unref?.();

  return {
    add(id) {
      running.set(id, Date.now());
      draw();
    },
    done(id, line) {
      running.delete(id);
      out.write(WIPE);
      if (line !== "") out.write(`${line}\n`);
      draw();
    },
    close() {
      clearInterval(beat);
      out.write(WIPE);
    },
  };
}
