/**
 * `wst update` — what changed since `init` wrote this repo.
 *
 * Reports; it does not merge. adr-0006 wants a 3-way merge against a recorded base
 * and pre-authorises this as the fallback if merging prose conflicts more than it
 * resolves. Starting here means the merge is earned by a report that proves it is
 * needed, rather than assumed.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFINITION_DIR } from "../core/paths.js";
import {
  BASE_FILE,
  classifyUpdate,
  parseBase,
  planInit,
  renderUpdate,
  type InitPlan,
} from "../core/init/index.js";
import { createGitAdapter } from "../shell/git.js";
import { banner } from "../banner.js";
import { findPayloadRoot, gatherFacts, readSkills } from "./init.js";

const EXIT_NO_BASE = 2;

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** What `init` would write today, by hash. */
function expectedOf(plan: InitPlan): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of plan.files) out.set(file.path, sha256(file.contents));
  for (const copy of plan.copies) {
    if (copy.contents !== undefined) out.set(copy.to, sha256(copy.contents));
  }
  return out;
}

/** What is there now. A path that cannot be read is ABSENT, never assumed unchanged. */
async function onDiskOf(paths: Iterable<string>, root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const path of paths) {
    const text = await readFile(join(root, path), "utf-8").catch(() => null);
    if (text !== null) out.set(path, sha256(text));
  }
  return out;
}

export interface UpdateOptions {
  readonly json?: boolean;
}

export async function runUpdate(
  opts: UpdateOptions,
  cwd: string = process.cwd(),
): Promise<number> {
  const root = (await createGitAdapter(cwd).repoRoot()) ?? cwd;

  const raw = await readFile(join(root, DEFINITION_DIR, BASE_FILE), "utf-8").catch(() => null);
  if (raw === null) {
    console.error(
      `no ${DEFINITION_DIR}/${BASE_FILE} — this repo was bootstrapped before wst recorded one,\n` +
        `or by hand. There is nothing to compare against, and guessing would be worse.`,
    );
    return EXIT_NO_BASE;
  }

  let base;
  try {
    base = parseBase(JSON.parse(raw));
  } catch (cause) {
    console.error(`${(cause as Error).message}`);
    return EXIT_NO_BASE;
  }

  // The SAME answers, re-planned by THIS version. That is the whole comparison:
  // one input, two renderers, and the difference is what the upgrade would change.
  const payloadRoot = await findPayloadRoot();
  let plan: InitPlan;
  try {
    plan = planInit({
      facts: await gatherFacts(root),
      answers: base.answers,
      clock: { now: () => new Date() },
      skillTexts: await readSkills(payloadRoot),
      presentSkills: [],
    });
  } catch (cause) {
    console.error(`could not re-plan from the recorded answers: ${(cause as Error).message}`);
    return EXIT_NO_BASE;
  }

  const expected = expectedOf(plan);
  const paths = new Set([...Object.keys(base.files), ...expected.keys()]);
  const verdicts = classifyUpdate({ base, onDisk: await onDiskOf(paths, root), expected });

  if (opts.json === true) {
    console.log(JSON.stringify({ base: { version: base.version, generatedAt: base.generatedAt }, verdicts }, null, 2));
    return 0;
  }

  console.log(`${banner()}\n\nupdate — ${root}`);
  console.log(`  recorded by wst ${base.version} on ${base.generatedAt}\n`);
  console.log(renderUpdate(verdicts));
  console.log(`\n  Reporting only — nothing was written. Re-copy what you want by hand.`);
  return 0;
}
