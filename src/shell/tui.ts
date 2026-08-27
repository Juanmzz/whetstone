/**
 * Raw-mode keys and a redrawn screen. No framework: the whole interaction is
 * `press(state, key)` in `core/tui`, and this reads one keypress at a time.
 */

import { emitKeypressEvents } from "node:readline";

export interface Keys {
  /** Resolves on the next key, as one of the names `press` understands. */
  next(): Promise<string>;
  close(): void;
}

const NAMES: Readonly<Record<string, string>> = {
  up: "up",
  down: "down",
  k: "up",
  j: "down",
  return: "return",
  escape: "escape",
  space: "space",
};

/**
 * Ctrl-C is answered here rather than by `press`, because a TUI that can trap
 * the interrupt is a TUI that can fail to release the terminal.
 */
export function rawKeys(input: NodeJS.ReadStream, onInterrupt: () => void): Keys {
  emitKeypressEvents(input);
  if (input.isTTY) input.setRawMode(true);
  input.resume();

  return {
    next: () =>
      new Promise<string>((resolve) => {
        const handler = (_ch: string, key: { name?: string; ctrl?: boolean }): void => {
          input.off("keypress", handler);
          if (key.ctrl === true && key.name === "c") {
            onInterrupt();
            return;
          }
          resolve(NAMES[key.name ?? ""] ?? key.name ?? "");
        };
        input.on("keypress", handler);
      }),
    close: () => {
      if (input.isTTY) input.setRawMode(false);
      input.pause();
    },
  };
}

const ESC = String.fromCharCode(27);
const CLEAR = `${ESC}[2J${ESC}[H`;
const HIDE = `${ESC}[?25l`;
const SHOW = `${ESC}[?25h`;

export function paint(out: NodeJS.WriteStream, lines: readonly string[]): void {
  out.write(`${CLEAR}${HIDE}${lines.join("\n")}\n`);
}

export function restore(out: NodeJS.WriteStream): void {
  out.write(SHOW);
}

/**
 * Play frames, and stop the moment anything is pressed.
 *
 * The skip is the whole reason this is allowed to exist: an entrance you
 * cannot interrupt is a delay you pay on every single open.
 */
export async function play(
  out: NodeJS.WriteStream,
  keys: Keys,
  frames: readonly (readonly string[])[],
  frameMs = 45,
): Promise<void> {
  let skipped = false;
  void keys.next().then(() => {
    skipped = true;
  });

  for (const frame of frames) {
    if (skipped) break;
    paint(out, frame);
    await new Promise((resolve) => setTimeout(resolve, frameMs));
  }
  const last = frames.at(-1);
  if (last !== undefined) paint(out, last);
}
