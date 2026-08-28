/**
 * `wst triage` — composition root. Reads the rules and either a diff or a list of
 * paths a human DECLARES, hands both to the pure core, prints the answer. No
 * classification decisions are made here.
 */

import { relative } from "node:path";
import { createGitAdapter } from "../shell/git.js";
import {
  loadRegistry,
  loadTriageRules,
  resolveDefinitionRoot,
  type LoadedTriageRules,
} from "../shell/sdd.js";
import { parseNameStatus, type ChangedFile } from "../core/diff/parse.js";
import { classify, route } from "../core/triage/index.js";
import { wrap, wrapped } from "../core/text.js";

export interface TriageOptions {
  /** `git diff --name-status <range>`. Defaults to the working tree vs HEAD. */
  readonly range?: string;
  /**
   * Repo-relative paths a human DECLARES they are about to touch, so the question
   * can be asked before the code exists. Mutually exclusive with `range`.
   */
  readonly paths?: readonly string[];
  readonly json?: boolean;
  /** Print the rule reason for every file, not just the one that set the tier. */
  readonly why?: boolean;
}

/**
 * Rejects rather than normalises what the rules cannot be about: an absolute or
 * escaping path matches no glob and would land at the `light` fallback, which
 * reads as a verdict instead of as a path nothing understood.
 */
function normaliseDeclared(paths: readonly string[]): string[] {
  if (paths.length === 0) throw new Error("no paths were declared");
  return paths.map((raw) => {
    const path = raw.trim().replace(/^\.\//, "");
    if (path === "") throw new Error("an empty path was declared");
    if (path.startsWith("/")) {
      throw new Error(`declared paths are repo-relative; ${JSON.stringify(raw)} is absolute`);
    }
    if (path.split("/").includes("..")) {
      throw new Error(`declared paths are repo-relative; ${JSON.stringify(raw)} leaves the repo`);
    }
    return path;
  });
}

/**
 * A declared path has no observed status, but `ChangedFile` requires one. Only
 * `renamed` changes what `classify` does, so `modified` cannot move the tier: it
 * is a placeholder, and the output below prints `observed: false` instead of it
 * rather than let a real-looking status out.
 */
function declaredFiles(paths: readonly string[]): ChangedFile[] {
  return paths.map((path) => ({ path, status: "modified" }));
}

export async function runTriage(
  opts: TriageOptions = {},
  cwd: string = process.cwd(),
): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = (await git.repoRoot()) ?? cwd;

  if (opts.paths !== undefined && opts.range !== undefined) {
    console.error(
      "--paths and --range answer different questions: one classifies what you declare, the other what git observed. Pass one.",
    );
    return 1;
  }
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

  let files: readonly ChangedFile[];
  let declared: string[] | undefined;
  if (opts.paths !== undefined) {
    try {
      declared = normaliseDeclared(opts.paths);
    } catch (cause) {
      console.error(`could not read the declared paths\n  ${(cause as Error).message}`);
      return 1;
    }
    files = declaredFiles(declared);
  } else {
    try {
      files = parseNameStatus(await git.diffNameStatus(range));
    } catch (cause) {
      // `parseNameStatus` throws rather than dropping a line it cannot read, so
      // that an unparsed path can never end up silently unclassified. Reporting it
      // as a failed run — not as an empty diff — is the whole point of that choice.
      console.error(`could not read the diff for ${range}\n  ${(cause as Error).message}`);
      return 1;
    }
  }

  const result = classify(files, source.rules);
  const routing = route(result.tier, registry.active);

  if (opts.json === true) {
    // Null rather than absent: a consumer reading `range` must get "no diff", not
    // a plausible default it will believe.
    const input =
      declared === undefined
        ? { range, declaredPaths: null }
        : { range: null, declaredPaths: declared };
    console.log(
      JSON.stringify(
        {
          ...input,
          rules: source.origin,
          triage:
            declared === undefined
              ? result
              : {
                  ...result,
                  matches: result.matches.map(({ file, tier, reason }) => ({
                    file: { path: file.path, observed: false },
                    tier,
                    reason,
                  })),
                },
          routing,
        },
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
  // Declared paths are not an observed range, and printing one where the other
  // goes would let a path nobody looked at read as a change somebody made.
  const input =
    declared === undefined
      ? `range: ${range}`
      : `declared: ${declared.length} ${declared.length === 1 ? "path" : "paths"}, no diff read`;
  console.log(`  rules: ${rules} (${source.rules.length} rules)  ·  ${input}`);

  if (result.matches.length > 0) {
    console.log(declared === undefined ? "\nfiles" : "\ndeclared paths (nothing observed to change)");
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
