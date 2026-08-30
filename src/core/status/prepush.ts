/**
 * Reading a shell hook without running it. PURE.
 *
 * The file that owns `core.hooksPath` is not always the file that calls the gate.
 */

const GATE = /(?:^|[\s;&|(/])(?:wst|whetstone|cli\.js)\s+gate(?:$|[\s;&|)])/;

/** A line whose first non-space character is `#` is not a call. */
function uncommented(text: string): string[] {
  return text.split("\n").filter((line) => !line.trimStart().startsWith("#"));
}

/** Whether this hook actually invokes the gate, by any of the names it is spelled. */
export function mentionsGate(text: string): boolean {
  return uncommented(text).some((line) => GATE.test(line));
}

const SOURCE = /^\s*(?:\.|source)\s+(.+)$/;

/**
 * The argument of a source line as a path, or "" when it needs a shell to know.
 *
 * Quotes come off wholesale, not as a matched pair: husky's `. "$(dirname "$0")/h"`
 * nests them, and a pair-matching read stops at `"$(dirname "`.
 */
function pathIn(argument: string): string {
  const bare = argument
    .replaceAll('"', "")
    .replaceAll("'", "")
    .replace(/\s+#.*$/, "")
    .trim()
    .replaceAll("$(dirname $0)", ".")
    .replaceAll("${0%/*}", ".");
  return bare.split(/\s/)[0] ?? "";
}

function joinPosix(dir: string, rest: string): string | null {
  const parts = `${dir}/${rest}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      // Nothing above the repository root is a hook of this repository.
      if (out.pop() === undefined) return null;
      continue;
    }
    out.push(part);
  }
  return out.length === 0 ? null : out.join("/");
}

/**
 * Every file this hook sources, repo-relative, in the order written. `self` is the
 * sourcing hook, since husky writes every path relative to it. A path built from a
 * variable is skipped rather than guessed.
 */
export function sourcedPaths(text: string, self: string): readonly string[] {
  const dir = self.includes("/") ? self.slice(0, self.lastIndexOf("/")) : ".";
  const found: string[] = [];
  for (const line of uncommented(text)) {
    const match = SOURCE.exec(line);
    if (match === null) continue;
    const raw = pathIn(match[1] ?? "");
    if (raw === "" || raw.includes("$")) continue;
    const resolved = raw.startsWith("/") ? null : joinPosix(dir, raw);
    if (resolved !== null) found.push(resolved);
  }
  return found;
}
