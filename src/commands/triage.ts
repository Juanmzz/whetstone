/**
 * `wst triage` — composition root. Reads the diff and the rules, hands both to
 * the pure core, prints the answer. No classification decisions are made here.
 */

import { relative } from "node:path";
import { createGitAdapter } from "../shell/git.js";
import {
  loadRegistry,
  loadTriageRules,
  resolveDefinitionRoot,
  type LoadedTriageRules,
} from "../shell/sdd.js";
import { parseNameStatus } from "../core/diff/parse.js";
import { classify, route } from "../core/triage/index.js";
import { wrap, wrapped } from "../core/text.js";

export interface TriageOptions {
  /** `git diff --name-status <range>`. Defaults to the working tree vs HEAD. */
  readonly range?: string;
  readonly json?: boolean;
  /** Print the rule reason for every file, not just the one that set the tier. */
  readonly why?: boolean;
}

export async function runTriage(
  opts: TriageOptions = {},
  cwd: string = process.cwd(),
): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = (await git.repoRoot()) ?? cwd;
  const range = opts.range ?? "HEAD";

  let source: LoadedTriageRules;
  let registry;
  try {
    const root = await resolveDefinitionRoot(repoRoot);
    [source, registry] = await Promise.all([loadTriageRules(root), loadRegistry(root)]);
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
  // Wrapped, not cut. The reason names the file that set the tier and then
  // says why, so a cut at eighty loses the half that answers the question.
  for (const line of wrapped(result.reason, 78, "  ")) console.log(line);
  // Relative. The absolute path is the same string on every line of every run
  // and the only part that varies is the tail.
  const rules = relative(repoRoot, source.origin) || source.origin;
  console.log(`  rules: ${rules} (${source.rules.length} rules)  ·  range: ${range}`);

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

  // Every line says what the value MEANS. It is read off the tier's row and
  // nothing here names where it came from or what it decides, so `autonomy
  // autonomous` was three words that answer nothing.
  console.log(`\nrouting  what the \`${result.tier}\` row of ${rules} sets`);
  console.log(`  autonomy  ${routing.autonomy.padEnd(11)} how far an agent may go before asking`);
  console.log(`  model     ${routing.modelTier.padEnd(11)} the model tier this work is worth`);
  console.log(`  autofix   ${(routing.autofix ? "yes" : "no").padEnd(11)} whether an agent may fix what a check reports`);
  const checks = routing.checks.length > 0 ? routing.checks.join(", ") : "(none at this tier)";
  const [first, ...rest] = wrap(checks, 66);
  console.log(`  checks    ${first ?? ""}`);
  for (const line of rest) console.log(`            ${line}`);
  if (routing.checks.length > 0) console.log(`            ^ what \`wst gate\` would run over this change`);

  return 0;
}
