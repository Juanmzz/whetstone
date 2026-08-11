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

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFINITION_DIR, LEGACY_DEFINITION_DIR } from "../src/core/paths.js";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (e) => {
      const full = join(dir, e.name);
      return e.isDirectory() ? walk(full) : [full];
    }),
  );
  return files.flat().filter((f) => f.endsWith(".ts"));
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

/**
 * ADR-0012 part 2: the old name is GONE, not deprecated.
 *
 * The ADR rejected supporting both paths — "a repo holding `.sdd/` and `.wst/` at
 * once has no source of truth" — so a leftover mention is not a cosmetic miss. In
 * live code it is a path that will not resolve; in live prose it is an instruction
 * pointing at a directory that does not exist, which is the same dangling-reference
 * failure `selfcontained.ts` exists to stop, aimed inward.
 *
 * What is deliberately EXEMPT, and why it is a principle rather than a shortcut:
 * the append-only records. ADR-0007 and hard rule 6 say accepted prose is never
 * rewritten — an ADR shows what was believed at the time, and editing it destroys
 * exactly that. Signals, proposals and the retro log are the same kind of artifact:
 * records of what was observed or proposed, on a day when the directory really was
 * called `.sdd/`. Rewriting them would forge the evidence the retro reasons over.
 */
describe("the old directory name is gone (ADR-0012)", () => {
  const SCANNED = [
    "src",
    "scripts",
    "plugin",
    ".githooks",
    ".github",
    ".claude/hooks",
    DEFINITION_DIR,
  ];

  const EXEMPT = [
    // Accepted prose and append-only evidence. See the block comment above.
    `${DEFINITION_DIR}/memory/decisions/`,
    `${DEFINITION_DIR}/memory/proposals/`,
    `${DEFINITION_DIR}/memory/signals.jsonl`,
    `${DEFINITION_DIR}/memory/retro-log.md`,
    // Declares the old name so the diagnostic can print it.
    "src/core/paths.ts",
    // Asserts on the old name, which is the only way to test the diagnostic.
    "src/core/paths.test.ts",
    "test/definition-dir.test.ts",
  ];

  async function walkAll(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (e) => {
        const full = join(dir, e.name);
        return e.isDirectory() ? walkAll(full) : [full];
      }),
    );
    return files.flat();
  }

  it("appears nowhere that is still live", async () => {
    const roots = [...SCANNED.map((d) => join(ROOT, d)), ROOT];
    const files = new Set<string>();
    for (const root of roots) {
      if (root === ROOT) continue;
      for (const f of await walkAll(root)) files.add(f);
    }
    // Root-level files that name the path, per the ADR's "Harder" section.
    for (const f of ["README.md", "VISION.md", "AGENTS.md", "package.json", "docs/PARALLEL.md"]) {
      files.add(join(ROOT, f));
    }

    const survivors: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (EXEMPT.some((e) => rel === e || rel.startsWith(e))) continue;
      const text = await readFile(file, "utf-8");
      text.split("\n").forEach((line, index) => {
        if (line.includes(LEGACY_DEFINITION_DIR)) survivors.push(`${rel}:${index + 1}  ${line.trim()}`);
      });
    }
    expect(survivors).toEqual([]);
  });
});
