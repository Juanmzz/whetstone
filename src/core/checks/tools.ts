/**
 * Which binaries a check's command would actually need. PURE.
 *
 * Reading the first word is not enough. `sift` declares `npm run test:e2e`;
 * npm is installed and `playwright`, two hops down, is not. The gate found out
 * by spawning it and getting exit 127.
 */

/** Never a missing tool: the shell provides them. */
const BUILTINS = new Set([
  "true", "false", "echo", "cd", "exit", "export", "set", "unset",
  "test", "[", ":", "read", "shift", "return", "source", ".",
]);

const SEPARATORS = /\s*(?:&&|\|\||[;|])\s*/;

/** `NODE_ENV=test vitest` runs vitest. */
function commandWord(segment: string): string | null {
  for (const word of segment.trim().split(/\s+/)) {
    if (word === "") continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    return word;
  }
  return null;
}

export function binariesFor(
  command: string,
  scripts: Readonly<Record<string, string>>,
  seen: ReadonlySet<string> = new Set(),
): readonly string[] {
  const found: string[] = [];

  for (const segment of command.split(SEPARATORS)) {
    const word = commandWord(segment);
    if (word === null || BUILTINS.has(word)) continue;

    const script = runTarget(segment, word);
    if (script !== null) {
      // A script that names itself would recurse forever; the run would too,
      // and that is npm's failure to report rather than one to predict.
      if (seen.has(script)) continue;
      const body = scripts[script];
      if (body === undefined) {
        found.push(word);
        continue;
      }
      found.push(...binariesFor(body, scripts, new Set([...seen, script])));
      continue;
    }

    found.push(word);
  }

  return [...new Set(found)];
}

/** The script name in `npm run X` / `pnpm run X` / `yarn X`, or null. */
function runTarget(segment: string, word: string): string | null {
  const words = segment.trim().split(/\s+/).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  if (word === "npm" || word === "pnpm" || word === "bun") {
    return words[1] === "run" ? (words[2] ?? null) : null;
  }
  if (word === "yarn") return words[1] === "run" ? (words[2] ?? null) : (words[1] ?? null);
  return null;
}
