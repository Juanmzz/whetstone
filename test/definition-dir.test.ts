/**
 * ADR-0012, part 1: the definition directory's name has exactly ONE owner.
 *
 * The rename it enables is a one-line change only while nothing else spells the
 * name out. 225 sites spelled it out before this test existed, and the ADR is
 * explicit about what that costs: "a rename done as a find-and-replace over 225
 * sites will drift the first time someone touches one of them." Only 9 of those
 * were the path literal; the rest sit inside prose `init` GENERATES and writes
 * into a target repo, which is why the constant has to reach both.
 *
 * What is checked, and what is deliberately not:
 *
 * - **String and template literals under `src/`** may not spell the name. Prose in
 *   a COMMENT may: a comment cannot interpolate, and "see `.wst/architecture.md`"
 *   is worth more to a reader than a sentence that talks around the name. This is
 *   why the scan below distinguishes the two instead of grepping.
 * - **`*.test.ts` is exempt** from that rule. A test asserting the literal
 *   `.wst/constitution.md` against generated output is the PIN on the constant's
 *   value; rewriting those to interpolate the constant would make them agree with
 *   whatever the constant says and assert nothing.
 * - **Files that cannot import it** — the plugin hooks, the emitter's output under
 *   `.claude/hooks/`, `package.json` — are cross-checked instead: they must spell
 *   the current name, and (once there is an old one) never the old one.
 */

import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { tempDir } from "./tmp.js";
import { describe, expect, it } from "vitest";
import { DEFINITION_DIR } from "../src/core/paths.js";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

/**
 * One directory, split into what can be recursed into and what can be READ.
 *
 * The whole point is `stat` rather than the Dirent. `readdir` reports a symlink as
 * a symlink, so `isDirectory()` is false for one — and `wst prepare` leases a
 * treehouse worktree whose `node_modules` is a symlink back to the main checkout.
 * Every enumeration below handed that symlink to `readFile`, which died with
 * EISDIR, so THIS FILE FAILED IN EVERY WORKTREE THE TOOL PREPARES. `test` is a
 * blocking check, so every crewmate's gate failed before the crewmate wrote a line.
 *
 * Named once and shared by all three enumerations, because the first fix only
 * repaired the root scan and left the same defect in `walkAll` one directory
 * deeper — where it still crashed on a symlink under `src/` or `scripts/`.
 * Resolving the link and asking what it points AT is also what keeps this honest:
 * filtering on `e.isFile()` would fix the crash by silently dropping symlinked
 * FILES, which is the allowlist mistake this file's own comments warn about.
 *
 * A broken link points at nothing and drops out of both lists. This test guards a
 * rename, not the filesystem.
 */
export async function split(dir: string): Promise<{ dirs: string[]; files: string[] }> {
  const dirs: string[] = [];
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    try {
      const info = await stat(full);
      if (info.isDirectory()) dirs.push(full);
      else if (info.isFile()) files.push(full);
    } catch {
      // Broken symlink, or something that vanished mid-scan. Nothing to read.
    }
  }
  return { dirs, files };
}

async function walk(dir: string): Promise<string[]> {
  const { dirs, files } = await split(dir);
  const nested = await Promise.all(dirs.map(walk));
  return [...files, ...nested.flat()].filter((f) => f.endsWith(".ts"));
}

/**
 * Blank out every comment, leaving code and its literals in place.
 *
 * Hand-written rather than parsed: TypeScript 7 is the native compiler and no
 * longer exposes `createSourceFile` to JS, so there is nothing to hand the file
 * to. A character scanner is enough for the one question asked here — is this
 * occurrence of the name in a comment, or in a value? — but only if it tracks
 * strings too, and this codebase proves why both directions matter:
 *
 * - `"src/core/**"` is a GLOB in a string. A comment scanner blind to strings
 *   reads its `/*` as a comment opener and swallows the rest of the file.
 * - `/[.,;:)\]`'"]+$/` (`core/init/selfcontained.ts`) is a regex containing a
 *   backtick, a single quote and a double quote. A string scanner blind to regex
 *   literals mistakes it for the start of three different strings.
 *
 * Replacing comment bodies with spaces rather than deleting them keeps line and
 * column numbers intact, so a violation still points at the real line.
 */
export function blankComments(text: string): string {
  const out = text.split("");
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };

  /** Whether a `/` here opens a regex literal or divides. */
  const regexAllowed = (upTo: number): boolean => {
    for (let i = upTo - 1; i >= 0; i--) {
      const c = text[i] as string;
      if (/\s/.test(c)) continue;
      // After a value, `/` divides. After an operator or an opener, it cannot.
      return !/[\w$)\]]/.test(c);
    }
    return true;
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      // Skip the literal WITHOUT blanking it — its contents are what we search.
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") i++;
        i++;
      }
      i++;
    } else if (c === "/" && regexAllowed(i)) {
      i++;
      let inClass = false;
      while (i < text.length && (inClass || text[i] !== "/")) {
        if (text[i] === "\\") i++;
        else if (text[i] === "[") inClass = true;
        else if (text[i] === "]") inClass = false;
        else if (text[i] === "\n") break; // not a regex after all; bail
        i++;
      }
      i++;
    } else {
      i++;
    }
  }

  return out.join("");
}

/**
 * Lines still naming `needle` as a DIRECTORY once comments are gone. 1-based.
 *
 * The trailing boundary is not decoration. `.sdd` as a bare substring also matches
 * `facts.sddPresent`, a property access; `.wst` also matches `.wst-charter.md` and
 * `.wst-lane`, which are real files and are not this directory. A guard that
 * matches more than it says gets muted, so the name must be followed by something
 * that cannot continue an identifier or a hyphenated filename.
 */
function codeLinesNaming(text: string, needle: string): { line: number; text: string }[] {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const asDirectory = new RegExp(`${escaped}(?![A-Za-z0-9_-])`);
  return blankComments(text)
    .split("\n")
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter((l) => asDirectory.test(l.text));
}

/**
 * The enumeration is load-bearing in the same way the scanner below is, and it had
 * no guard at all: CI runs `npm ci`, so `node_modules` is a real directory there
 * and `isDirectory()` answered correctly. The bug only appeared in a worktree
 * `wst prepare` leased — which is to say, only where a crewmate works. Reverting
 * the fix left CI green.
 *
 * These run against a temp directory rather than the repo, so they fail on the
 * defect and not on whatever happens to be lying around the checkout.
 */
describe("splitting a directory into what can be read", () => {
  const temp = async (): Promise<string> =>
    await tempDir("wst-split-", true);

  it("treats a symlinked directory as a directory, not as a file to read", async () => {
    // The exact shape treehouse produces: `node_modules` linked to another tree.
    const dir = await temp();
    await mkdir(join(dir, "real"), { recursive: true });
    await symlink(join(dir, "real"), join(dir, "linked"));

    const { dirs, files } = await split(dir);
    expect(files).toEqual([]);
    expect(dirs.map((d) => basename(d)).sort()).toEqual(["linked", "real"]);
  });

  it("still reads a symlinked FILE, which `isFile()` on the Dirent would have dropped", async () => {
    // The other direction, and why this resolves the link instead of filtering on
    // the Dirent. A config file symlinked into place is still a config file.
    const dir = await temp();
    await writeFile(join(dir, "real.md"), "x\n", "utf-8");
    await symlink(join(dir, "real.md"), join(dir, "linked.md"));

    const { files } = await split(dir);
    expect(files.map((f) => basename(f)).sort()).toEqual(["linked.md", "real.md"]);
  });

  it("drops a broken symlink instead of throwing mid-scan", async () => {
    const dir = await temp();
    await symlink(join(dir, "gone"), join(dir, "dangling"));

    const { dirs, files } = await split(dir);
    expect([...dirs, ...files]).toEqual([]);
  });
});

/**
 * The scanner is load-bearing: if it mis-parsed every file into one big comment,
 * every check below would pass while proving nothing. So it is tested first, on
 * the exact shapes that broke the naive versions.
 */
describe("the comment scanner", () => {
  it("keeps a glob that looks like a comment opener", () => {
    expect(codeLinesNaming(`const g = ".sdd/skills/**";`, ".sdd")).toHaveLength(1);
  });

  it("keeps a name inside a template literal", () => {
    expect(codeLinesNaming("const p = `${root}/.sdd/x.md`;", ".sdd")).toHaveLength(1);
  });

  it("drops a name that is only in prose", () => {
    expect(codeLinesNaming("// see `.sdd/architecture.md`\nconst x = 1;", ".sdd")).toEqual([]);
    expect(codeLinesNaming("/**\n * `.sdd/` is the source of truth.\n */", ".sdd")).toEqual([]);
  });

  it("is not derailed by a regex holding quotes and backticks", () => {
    const line = 'const t = s.replace(/[.,;:)\\]`\'"]+$/, "") + ".sdd";';
    expect(codeLinesNaming(line, ".sdd")).toHaveLength(1);
  });

  it("does not read a comment marker inside a string as a comment", () => {
    expect(codeLinesNaming(`const u = "a//b"; const d = ".sdd";`, ".sdd")).toHaveLength(1);
  });

  it("does not mistake a longer name that merely starts with it", () => {
    expect(codeLinesNaming("if (facts.sddPresent) return;", ".sdd")).toEqual([]);
    expect(codeLinesNaming('const p = ".wst-charter.md";', ".wst")).toEqual([]);
    expect(codeLinesNaming('const p = ".wst/x";', ".wst")).toHaveLength(1);
  });
});

describe("the definition directory has one owner (ADR-0012)", () => {
  it("is exported as a constant", () => {
    expect(DEFINITION_DIR).toMatch(/^\.[a-z]+$/);
  });

  it("no value under src/ or scripts/ spells the directory name", async () => {
    // `scripts/` is in scope because it imports from `src/`: anything that CAN
    // reach the constant has no excuse for spelling the name itself.
    const files = [...(await walk(SRC)), ...(await walk(join(ROOT, "scripts")))].filter(
      (f) => !f.endsWith(".test.ts") && relative(SRC, f) !== "core/paths.ts",
    );
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf-8");
      if (!text.includes(DEFINITION_DIR)) continue; // cheap reject before scanning
      for (const hit of codeLinesNaming(text, DEFINITION_DIR)) {
        violations.push(`${relative(ROOT, file)}:${hit.line}  ${hit.text.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });

  /**
   * The files that CANNOT import it. A hook shipped in the plugin runs in a repo
   * with no Whetstone build to import from, so it hardcodes the name — and a
   * hardcoded name with nothing checking it is precisely the drift ADR-0012 is
   * about. Checking it here is what gives the constant ownership of it anyway.
   */
  it("every file that must hardcode the name agrees with the constant", async () => {
    const mustAgree = [
      "plugin/hooks/strict-path-guard.mjs",
      "plugin/hooks/gate-on-stop.mjs",
      ".claude/hooks/lane-guard.mjs",
      "package.json",
    ];

    const disagreements: string[] = [];
    for (const rel of mustAgree) {
      const text = await readFile(join(ROOT, rel), "utf-8");
      if (!text.includes(DEFINITION_DIR)) disagreements.push(`${rel} never names ${DEFINITION_DIR}`);
    }
    expect(disagreements).toEqual([]);
  });
});

