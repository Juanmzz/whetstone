/**
 * `wst plan` at the boundary: a real repository, a real plan file, real exit codes.
 *
 * `src/commands/` is light tier and carries no test ceremony by default. These
 * cases earn it because they are about the EXIT CODE, and no pure test of
 * `core/plan/` can reach it. ADR-0013 says this command "does not block" and hard
 * rule 3 says a nonzero code may only mean the command could not run — two claims
 * that are worth exactly as much as the thing that pins them.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPlan } from "../src/commands/plan.js";

const git = promisify(execFile);

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
});

afterEach(() => void vi.restoreAllMocks());

/** A repo with a definition directory holding one blocking check and one rule. */
async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wst-plan-cmd-"));
  await git("git", ["init", "-q"], { cwd: dir });
  // Spelled out rather than built from DEFINITION_DIR: this asserts the value the
  // constant is supposed to have, which is what `test/definition-dir.test.ts`
  // exempts test files in order to keep possible.
  await mkdir(join(dir, ".wst", "checks"), { recursive: true });
  await writeFile(
    join(dir, ".wst", "triage.yaml"),
    "version: 1\nrules:\n  - glob: \"src/core/**\"\n    tier: strict\n    reason: the engine\n",
  );
  await writeFile(
    join(dir, ".wst", "checks", "typecheck.md"),
    "---\nid: typecheck\ndescription: It compiles.\nkind: deterministic\nseverity: block\ntiers: [strict]\ninclude: [\"src/**/*.ts\"]\ncommand: npm run typecheck\n---\nbody\n",
  );
  return dir;
}

const plan = async (dir: string, text: string): Promise<string> => {
  const path = join(dir, "PLAN.md");
  await writeFile(path, text);
  return path;
};

const printed = (): string => out.join("\n");

describe("wst plan", () => {
  it("exits 0 on a readable plan, whatever it finds", async () => {
    // The whole point of ADR-0013's "it does not block": this plan has an uncovered
    // strict path, which is the most alarming thing the command can report, and it
    // still exits 0. The gate is the human.
    const dir = await repo();
    const file = await plan(dir, "---\npaths: [src/core/a.ts, src/core/NOTES.md]\n---\n");
    expect(await runPlan({ file }, dir)).toBe(0);
    expect(printed()).toContain("VERIFY BY HAND");
  });

  it("exits 2 on a plan it cannot parse, and reports nothing about the tier", async () => {
    const dir = await repo();
    const file = await plan(dir, "# a plan with no frontmatter\n");
    expect(await runPlan({ file }, dir)).toBe(2);
    // Not "tier: light". A plan whose paths could not be read has no tier, and
    // printing one anyway is the confident-wrong-answer failure the parser exists
    // to prevent.
    expect(printed()).toBe("");
    expect(err.join("\n")).toContain("no YAML frontmatter");
  });

  it("exits 2 when the plan file is not there", async () => {
    const dir = await repo();
    expect(await runPlan({ file: join(dir, "nope.md") }, dir)).toBe(2);
  });

  it("routes from the repo's own rules and registry, not from built-in defaults", async () => {
    const dir = await repo();
    const file = await plan(dir, "---\npaths: [src/core/a.ts]\n---\n");
    expect(await runPlan({ file, json: true }, dir)).toBe(0);
    const result = JSON.parse(printed()) as { triage: { rulesSource: string }; blocking: { id: string }[] };
    expect(result.triage.rulesSource).toContain("triage.yaml");
    expect(result.blocking.map((c) => c.id)).toEqual(["typecheck"]);
  });

  it("keeps the full triage reason in --json, where nothing is truncated", async () => {
    const dir = await repo();
    const file = await plan(dir, "---\npaths: [src/core/a.ts]\n---\n");
    await runPlan({ file, json: true }, dir);
    expect(printed()).toContain("the engine");
    expect(printed()).not.toContain("…");
  });
});
