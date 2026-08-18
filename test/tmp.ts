/**
 * A temporary directory that removes itself when the run ends.
 *
 * Every test that needs a repo built one with `mkdtemp` and left it there. Over
 * a day of runs that reached **21,833 directories and 1.4 GB**, which filled a
 * 1.9 GB tmpfs — and then the suite failed with `EDQUOT` on a `writeFile`, which
 * reads as a bug in the code under test. It cost a diagnosis before anyone
 * looked at `df`.
 *
 * Registered against the whole file rather than each test: several are created
 * in `beforeAll`, and a per-test hook would remove a directory the next test in
 * the same describe still needs.
 *
 * Removal is best-effort. A directory that cannot be removed is a slower leak
 * than the one this fixes, and failing a green suite over cleanup teaches people
 * to distrust the failure.
 */

import { afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];

afterAll(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
  created.length = 0;
});

/**
 * @param prefix the same `wst-…-` prefix the call site used, so a directory that
 *   does survive a crash still says which test made it.
 * @param real whether to resolve symlinks. macOS puts `/var` behind `/private`,
 *   and a test comparing a path git printed against this one needs them to agree.
 */
export async function tempDir(prefix: string, real = false): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return real ? realpathSync(dir) : dir;
}
