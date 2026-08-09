#!/usr/bin/env node
/**
 * Warns Claude, at the moment of the edit, that a path ships with full TDD.
 *
 * Reads `.sdd/triage.yaml` AT RUN TIME. The version `wst init` wrote into each repo had
 * the strict paths compiled in, so editing triage.yaml left the hook warning about
 * yesterday's rules with nothing to say so. A plugin serves every project and cannot
 * bake anything in, which turns that constraint into the fix.
 *
 * ADVISORY ONLY — exit 0, `additionalContext`, never a denial. The gate is the channel
 * that stops things (ADR-0009); a hook that blocked edits would be a second authority
 * that can disagree with it, and this one runs before the code it would judge exists.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

const root = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

let input = "";
for await (const chunk of process.stdin) input += chunk;

let filePath;
try {
  filePath = JSON.parse(input)?.tool_input?.file_path;
} catch {
  process.exit(0); // malformed input is the harness's problem, not the user's
}
if (typeof filePath !== "string" || filePath === "") process.exit(0);

const rel = isAbsolute(filePath) ? relative(root, filePath) : filePath;
if (rel.startsWith("..")) process.exit(0); // outside the project

/**
 * The strict globs, scraped rather than parsed.
 *
 * A YAML parser is a dependency, and a hook with dependencies is a hook that breaks on
 * somebody's machine for reasons unrelated to their code. The shape it reads is fixed
 * by `core/triage/rules.ts`, and the failure mode of a scrape is MISSING a rule, which
 * under-warns. Over-warning is the one that trains people to ignore it.
 */
function strictGlobs() {
  try {
    const lines = readFileSync(join(root, ".sdd", "triage.yaml"), "utf8").split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const glob = /^\s*-\s*glob:\s*["']?(.+?)["']?\s*$/.exec(lines[i] ?? "");
      if (glob === null) continue;
      // `tier:` is the next such line before the following entry starts.
      for (let j = i + 1; j < lines.length && !/^\s*-\s*glob:/.test(lines[j] ?? ""); j++) {
        const tier = /^\s*tier:\s*(\w+)/.exec(lines[j] ?? "");
        if (tier === null) continue;
        if (tier[1] === "strict") out.push(glob[1]);
        break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

// Globs, `**` and `*` only. Enough for the ones triage actually uses.
//
// The two `**` forms are NOT the same, and collapsing them was this function's first
// bug. A trailing `**` means "everything below here, filename included"; a `**` with a
// slash after it means "any depth, including none". Treating the first like the second
// built a pattern requiring the path to end in a slash, so it matched no file at all —
// the hook stayed silent on every strict path and looked like it was working.
//
// Line comments, not a block: the pattern this fixes contains the characters that end
// a block comment, and the first version of this note terminated itself.
function matches(path, glob) {
  const ANYDEPTH = "\u0001";
  const EVERYTHING = "\u0002";
  const rx = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, ANYDEPTH)
    .replace(/\*\*/g, EVERYTHING)
    .replace(/\*/g, "[^/]*")
    .split(ANYDEPTH).join("(?:.*/)?")
    .split(EVERYTHING).join(".*");
  return new RegExp(`^${rx}$`).test(path);
}

const hit = strictGlobs().find((g) => matches(rel, g));
if (hit !== undefined) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext:
          `STRICT-TIER EDIT (${rel}, matched \`${hit}\`). Per .sdd/triage-rules.md this ` +
          `path ships with full TDD — RED first — and a fresh-context review. ` +
          `Write the failing test before the implementation.`,
      },
    }),
  );
}
process.exit(0);
