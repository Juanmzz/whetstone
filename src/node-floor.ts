/**
 * Whether this Node can run Whetstone at all.
 *
 * Imports nothing and uses no syntax newer than Node 12, because it runs on the
 * Node it is about to refuse.
 */

function parts(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** One line for a Node below the `engines` floor, null for one that will do. */
export function tooOldMessage(current: string, engines: string): string | null {
  const floor = /^\s*>=\s*(\d+\.\d+\.\d+)\s*$/.exec(engines);
  const have = parts(current);
  const need = floor === null ? null : parts(floor[1] as string);
  if (have === null || need === null) return null;

  for (let i = 0; i < 3; i++) {
    const a = have[i] as number;
    const b = need[i] as number;
    if (a > b) return null;
    if (a < b) {
      return `wst needs Node ${need.join(".")} or newer, and this is Node ${current} (${process.execPath}). Nothing was verified.`;
    }
  }
  return null;
}
