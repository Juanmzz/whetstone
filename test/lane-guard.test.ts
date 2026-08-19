/**
 * The lane guard against the file it claims to be generated from.
 *
 * `.claude/hooks/lane-guard.mjs` opens with *"GENERATED … from docs/lanes.yaml
 * (ADR-0005). Do NOT edit by hand"*, and nothing generated it or checked it. It
 * drifted: the hook carried an `annotate` lane over `src/core/annotate/`,
 * `src/commands/pr.ts` and `src/shell/github.ts` — a lane ADR-0009 retired and
 * three paths that do not exist. `WST_LANE=annotate` passed the known-lane test
 * and was granted a boundary over deleted files.
 *
 * This is hard rule 5's enforcement mechanism, so "nothing checks it" is the part
 * that mattered. The hook is `.mjs` and read at run time by Claude Code, which is
 * why it is pinned by parsing rather than by importing.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("..", import.meta.url).pathname;

const read = (rel: string): Promise<string> => readFile(join(repoRoot, rel), "utf-8");

/** The `LANES` object literal in the hook, as `{ lane: [owned paths] }`. */
async function hookLanes(): Promise<Record<string, string[]>> {
  const text = await read(".claude/hooks/lane-guard.mjs");
  const block = /const LANES = \{([\s\S]*?)\n\};/.exec(text)?.[1];
  if (block === undefined) throw new Error("lane-guard.mjs has no `const LANES = {...}` block");

  const lanes: Record<string, string[]> = {};
  for (const line of block.split("\n")) {
    const entry = /^\s*([a-z][\w-]*):\s*\[(.*)\],?\s*$/.exec(line);
    if (entry === null) continue;
    const [, id = "", list = ""] = entry;
    lanes[id] = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  }
  return lanes;
}

/** Lane ids and their `owns:` lists, read out of the YAML without a parser. */
async function declaredLanes(): Promise<Record<string, string[]>> {
  const text = await read("docs/lanes.yaml");
  const block = text.slice(text.indexOf("\nlanes:"));

  const lanes: Record<string, string[]> = {};
  let current: string | null = null;
  let inOwns = false;
  for (const line of block.split("\n")) {
    const lane = /^ {2}([a-z][\w-]*):\s*$/.exec(line);
    if (lane !== null) {
      current = lane[1] ?? null;
      if (current !== null) lanes[current] = [];
      inOwns = false;
      continue;
    }
    if (current === null) continue;

    if (/^ {4}owns:\s*$/.test(line)) {
      inOwns = true;
      continue;
    }
    if (/^ {4}\w+:/.test(line)) {
      inOwns = false;
      continue;
    }
    if (!inOwns) continue;

    const owned = /^ {6}-\s*"?([^"#\s]+)"?/.exec(line);
    if (owned !== null) lanes[current]?.push(owned[1] ?? "");
  }
  return lanes;
}

describe("the lane guard is the lanes file, compiled", () => {
  it("enforces exactly the lanes the definition declares — no more, no fewer", async () => {
    // An EXTRA lane in the hook is the dangerous direction: it is a boundary
    // nobody declared, and `WST_LANE=<it>` passes the known-lane check.
    expect(Object.keys(await hookLanes()).sort()).toEqual(Object.keys(await declaredLanes()).sort());
  });

  it("gives each lane exactly the paths its `owns:` list declares", async () => {
    expect(await hookLanes()).toEqual(await declaredLanes());
  });

  it("grants no lane a path that is not in the repository", async () => {
    // What made the drift visible: three of `annotate`'s paths had been deleted,
    // so the boundary it enforced could never match anything a crewmate wrote.
    const { access } = await import("node:fs/promises");
    const missing: string[] = [];

    for (const paths of Object.values(await hookLanes())) {
      for (const path of paths) {
        // `foo*` is a string prefix, so check the directory it sits in.
        const probe = path.endsWith("*") ? join(path, "..") : path;
        await access(join(repoRoot, probe)).catch(() => missing.push(path));
      }
    }

    expect(missing).toEqual([]);
  });
});
