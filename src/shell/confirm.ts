/**
 * One question, one keypress, for the step that spends money (adr-0032).
 *
 * It answers YES where there is nobody to ask: a script blocked on a prompt it
 * cannot see is worse than the cost it was guarding.
 */

import { rawKeys, restore } from "./tui.js";

export async function confirm(question: string, out: NodeJS.WriteStream = process.stdout): Promise<boolean> {
  if (process.stdin.isTTY !== true) return true;

  out.write(`${question} [enter to go, anything else stops] `);

  const keys = rawKeys(process.stdin, () => {
    keys.close();
    restore(out);
    process.exit(130);
  });

  try {
    const key = await keys.next();
    out.write("\n");
    return key === "return";
  } finally {
    keys.close();
    restore(out);
  }
}
