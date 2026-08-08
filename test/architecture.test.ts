import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

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

const IMPORT_RE = /(?:from|import)\s+["']([^"']+)["']/g;

/**
 * The one-way import rule (constitution non-negotiable 6).
 *
 * Be precise about what this proves: it enforces import DIRECTION. It is what makes
 * "the core never calls an LLM" an architectural fact rather than a promise — the
 * core cannot reach an adapter, so the only way in is a port passed as a parameter.
 * It does NOT by itself stop judgment logic accreting in `src/commands/`; the
 * `core/orchestrate/` tier exists to give that logic a home the tests can reach.
 */
describe("FCIS boundary", () => {
  it("no file under core/ imports from shell/", async () => {
    const coreFiles = await walk(join(SRC, "core"));
    expect(coreFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of coreFiles) {
      const text = await readFile(file, "utf-8");
      for (const match of text.matchAll(IMPORT_RE)) {
        const spec = match[1] ?? "";
        if (spec.includes("shell/") || spec.includes("/shell")) {
          violations.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no file under core/ spawns a process or touches the filesystem directly", async () => {
    const coreFiles = await walk(join(SRC, "core"));
    const banned = ["node:child_process", "node:fs", "node:fs/promises", "child_process", "fs"];

    const violations: string[] = [];
    for (const file of coreFiles) {
      const text = await readFile(file, "utf-8");
      for (const match of text.matchAll(IMPORT_RE)) {
        const spec = match[1] ?? "";
        if (banned.includes(spec)) violations.push(`${relative(SRC, file)} -> ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
