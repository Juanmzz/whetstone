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
  return: "return",
  escape: "escape",
  space: "space",
};
// NOT j/k here. Aliasing them to movement makes two letters untypeable in a
// text field, which cost a `k` in "a task capture app". The reader reports what
// was pressed; a model that wants vim keys says so itself.

/**
 * A form needs the characters themselves, not just names: in a text field every
 * letter is input, so a letter shortcut is a letter the user cannot type.
 */
function nameOf(ch: string, key: { name?: string; ctrl?: boolean; shift?: boolean; sequence?: string }): string {
  if (key.ctrl === true && key.name !== undefined) return `ctrl-${key.name}`;
  if (key.shift === true && key.name === "tab") return "shift-tab";
  const named = NAMES[key.name ?? ""];
  if (named !== undefined) return named;
  // A printable character arrives as itself; a named key does not.
  if (typeof ch === "string" && ch.length === 1 && ch >= " ") return ch;
  return key.name ?? "";
}

/**
 * Ctrl-C is answered here rather than by `press`, because a TUI that can trap
 * the interrupt is a TUI that can fail to release the terminal.
 */
export function rawKeys(input: NodeJS.ReadStream, onInterrupt: () => void): Keys {
  emitKeypressEvents(input);
  if (input.isTTY) input.setRawMode(true);
  input.resume();

  // QUEUED, not one-shot. Attaching a handler per read drops everything that
  // arrives between reads, so anyone typing faster than the render loop loses
  // characters: measured, "a task capture app" arrived as "a".
  const pending: string[] = [];
  let waiting: ((key: string) => void) | null = null;

  const onKey = (ch: string, key: { name?: string; ctrl?: boolean; shift?: boolean; sequence?: string }): void => {
    if (key.ctrl === true && key.name === "c") {
      onInterrupt();
      return;
    }
    const named = nameOf(ch, key);
    if (waiting !== null) {
      const resolve = waiting;
      waiting = null;
      resolve(named);
    } else {
      pending.push(named);
    }
  };
  input.on("keypress", onKey);

  return {
    next: () =>
      new Promise<string>((resolve) => {
        const queued = pending.shift();
        if (queued !== undefined) resolve(queued);
        else waiting = resolve;
      }),
    close: () => {
      input.off("keypress", onKey);
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
