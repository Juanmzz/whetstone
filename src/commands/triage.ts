/**
 * `wst triage` — composition root. Reads the diff and the rules, hands both to
 * the pure core, prints the answer. No classification decisions are made here.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGitAdapter } from "../shell/git.js";
import { loadRegistry, resolveDefinitionRoot } from "../shell/sdd.js";
import { parseNameStatus } from "../core/diff/parse.js";
import { classify, DEFAULT_RULES, parseTriageRules, route } from "../core/triage/index.js";
import type { TriageRule } from "../core/contracts.js";

export const TRIAGE_RULES_FILE = "triage.yaml";

export interface TriageOptions {
  /** `git diff --name-status <range>`. Defaults to the working tree vs HEAD. */
  readonly range?: string;
  readonly json?: boolean;
  /** Print the rule reason for every file, not just the one that set the tier. */
  readonly why?: boolean;
}

interface RuleSource {
  readonly rules: readonly TriageRule[];
  readonly origin: string;
}

/**
 * A missing `.wst/triage.yaml` is NOT an error: the built-in defaults are the
 * same ruleset, and a project that has not written one yet should still be
 * triaged rather than crash. A malformed one IS an error — falling back there
 * would silently ignore rules someone deliberately wrote.
 */
async function loadRules(definitionRoot: string): Promise<RuleSource> {
  const path = join(definitionRoot, TRIAGE_RULES_FILE);

  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch {
    return { rules: DEFAULT_RULES, origin: "built-in defaults" };
  }

  return { rules: parseTriageRules(text, path), origin: path };
}

/**
 * Display only. The full reason always survives into `--json` and `--why`: a
 * terminal is a viewport, and the receipt must not be shortened to fit it.
 */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export async function runTriage(
  opts: TriageOptions = {},
  cwd: string = process.cwd(),
): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = (await git.repoRoot()) ?? cwd;
  const range = opts.range ?? "HEAD";

  let source: RuleSource;
  let registry;
  try {
    const root = await resolveDefinitionRoot(repoRoot);
    [source, registry] = await Promise.all([loadRules(root), loadRegistry(root)]);
  } catch (cause) {
    // Same posture as `wst check`: unloadable configuration means an unclassified
    // change, and the whole point is that this cannot happen quietly.
    console.error(`triage configuration failed to load\n  ${(cause as Error).message}`);
    return 1;
  }

  let files;
  try {
    files = parseNameStatus(await git.diffNameStatus(range));
  } catch (cause) {
    // `parseNameStatus` throws rather than dropping a line it cannot read, so
    // that an unparsed path can never end up silently unclassified. Reporting it
    // as a failed run — not as an empty diff — is the whole point of that choice.
    console.error(`could not read the diff for ${range}\n  ${(cause as Error).message}`);
    return 1;
  }

  const result = classify(files, source.rules);
  const routing = route(result.tier, registry.active);

  if (opts.json === true) {
    console.log(
      JSON.stringify(
        { range, rules: source.origin, triage: result, routing },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`triage  ${result.tier}`);
  console.log(`  ${truncate(result.reason, 160)}`);
  console.log(`  rules: ${source.origin} (${source.rules.length})  ·  range: ${range}`);

  if (result.matches.length > 0) {
    console.log("\nfiles");
    if (opts.why === true) {
      // A rule's `reason` is a paragraph — it is the audit trail, not a label.
      // Padding it into a column produces something nobody reads, so it gets its
      // own indented line and the full text.
      for (const match of result.matches) {
        console.log(`  ${match.tier.padEnd(6)}  ${match.file.path}`);
        console.log(`          ${match.reason}`);
      }
    } else {
      for (const match of result.matches) {
        console.log(`  ${match.tier.padEnd(6)}  ${match.file.path}`);
      }
    }
  }

  console.log("\nrouting");
  console.log(`  autonomy  ${routing.autonomy}`);
  console.log(`  model     ${routing.modelTier}`);
  console.log(`  autofix   ${routing.autofix ? "yes" : "no"}`);
  console.log(
    `  checks    ${routing.checks.length > 0 ? routing.checks.join(", ") : "(none at this tier)"}`,
  );

  return 0;
}
