/**
 * What a person is told when a command they picked finishes. PURE.
 *
 * `<cmd> exited 0` is the vocabulary of whoever wrote the tool. A process code
 * belongs in a script; this line belongs to the person who pressed enter.
 */

export function afterRunning(command: string, code: number): string {
  const said =
    code === 0
      ? `${command} done`
      : command === "gate" && code === 1
        ? "gate BLOCKED this change"
        : // Hard rule 3, in the one line a menu reader sees: a check that could
          // not run is the gate being broken and never a verdict on the change.
          command === "gate" && code === 2
          ? "gate could not run every check, so this is unverified"
          : `${command} did not finish`;

  const tail = code === 0 ? "" : ` (exit ${String(code)})`;
  return `${said}${tail} · any key for the menu, q quits`;
}
