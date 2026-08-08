/**
 * `wst check` — composition root. Loads the registry, prints it, optionally
 * compiles the index. No decisions here.
 */

import { join } from "node:path";
import { createGitAdapter } from "../shell/git.js";
import { loadRegistry, writeIndex } from "../shell/sdd.js";
import type { LoadedCheck } from "../core/checks/registry.js";

export interface CheckOptions {
  readonly json?: boolean;
  readonly compile?: boolean;
}

function severityMark(check: LoadedCheck): string {
  if (!check.enabled) return "off  ";
  return { block: "BLOCK", warn: "warn ", annotate: "note " }[check.severity];
}

export async function runCheck(opts: CheckOptions, cwd: string = process.cwd()): Promise<number> {
  const repoRoot = (await createGitAdapter(cwd).repoRoot()) ?? cwd;
  const sddRoot = join(repoRoot, ".sdd");

  let registry;
  try {
    registry = await loadRegistry(sddRoot);
  } catch (cause) {
    // A malformed check must fail loudly: an unloadable registry means an
    // ungated change, and the whole point is that this cannot happen quietly.
    console.error(`check registry failed to load\n  ${(cause as Error).message}`);
    return 1;
  }

  if (opts.json === true) {
    console.log(JSON.stringify(registry.index, null, 2));
    return 0;
  }

  if (registry.all.length === 0) {
    console.log("no checks registered — add files under .sdd/checks/<id>.md");
    return 0;
  }

  console.log(`checks (${registry.active.length} active of ${registry.all.length})\n`);
  for (const check of registry.all) {
    const kind = check.kind === "agent-lens" ? "lens" : "det ";
    const cal =
      check.kind === "agent-lens"
        ? ` [calibration: ${check.calibration?.status ?? "uncalibrated"}]`
        : "";
    console.log(`  ${severityMark(check)} ${kind}  ${check.id.padEnd(14)} ${check.description}${cal}`);
  }

  if (registry.index.blocking.length > 0) {
    console.log(`\n  may block: ${registry.index.blocking.join(", ")}`);
  }

  if (opts.compile === true) {
    const path = await writeIndex(sddRoot, registry);
    console.log(`\n  wrote ${path}`);
  }

  return 0;
}
