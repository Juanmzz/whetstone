/**
 * What a person is told when a command they picked finishes. PURE.
 *
 * `<cmd> exited 0` is the vocabulary of whoever wrote the tool. A process code is
 * protocol for a shell; this line belongs to the person who pressed enter, and it
 * carries NO number at all. The semantic states are the product's words.
 */

const READY = "Ready. Everything that applied ran and passed";
const NOT_READY = "Needs work. A check failed on this change";
const INCOMPLETE = "Verification incomplete. Something could not be established";

export function afterRunning(command: string, code: number): string {
  const said = sentenceFor(command, code);
  return `${said} · any key for the menu, q quits`;
}

function sentenceFor(command: string, code: number): string {
  if (command === "ready") {
    // Hard rule 3, in the one line a menu reader sees: a check that could not run
    // is verification being incomplete, and never a verdict on the change.
    if (code === 0) return READY;
    return code === 1 ? NOT_READY : INCOMPLETE;
  }
  if (code === 0) return `${command} done`;
  return code === 1 ? `${command} found something` : `${command} could not finish`;
}
