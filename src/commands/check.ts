/**
 * `wst check` — composition root. Loads the registry, prints it, optionally
 * compiles the index. No decisions here.
 */

import { createGitAdapter } from "../shell/git.js";
import { loadRegistry, resolveDefinitionRoot, writeIndex } from "../shell/sdd.js";
import { DEFINITION_DIR } from "../core/paths.js";
import { renderRegistry } from "../core/checks/report.js";

export interface CheckOptions {
  readonly json?: boolean;
  readonly compile?: boolean;
}

export async function runCheck(opts: CheckOptions, cwd: string = process.cwd()): Promise<number> {
  const repoRoot = (await createGitAdapter(cwd).repoRoot()) ?? cwd;
  let definitionRoot: string;
  let registry;
  try {
    definitionRoot = await resolveDefinitionRoot(repoRoot);
    registry = await loadRegistry(definitionRoot);
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

  for (const line of renderRegistry({ definitionDir: DEFINITION_DIR, checks: registry.all })) {
    console.log(line);
  }

  if (opts.compile === true) {
    const path = await writeIndex(definitionRoot, registry);
    console.log(`\n  wrote ${path}`);
  }

  return 0;
}
