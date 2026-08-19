/** Small filesystem questions the adapters and composition roots both ask. */

import { access } from "node:fs/promises";

/** Whether a path is reachable. Four copies of this existed. */
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
