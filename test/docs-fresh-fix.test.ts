/**
 * `--fix` writes the counts the check would otherwise only complain about.
 *
 * Two gate-blocked signals a day apart (`sig-a9ff00c4`, `sig-5c2d6751`) are the same
 * root cause: numbers that are one file operation away drift every time an ADR or a
 * signal lands, and a check that can only fail leaves the bookkeeping to a human who
 * has already been told twice.
 *
 * The gate itself still only checks. A fix that ran inside the gate would rewrite the
 * tree after the commit it was judging already existed, and in CI would write to a
 * runner nobody keeps.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { DEFINITION_DIR } from "../src/core/paths.js";
import { tempDir } from "./tmp.js";

const exec = promisify(execFile);
const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-docs-fresh.ts");

/** Two ADRs, three signals, one command — none of which the status line will claim. */
async function repoWith(status: string): Promise<string> {
  const dir = await tempDir("wst-docs-fix-");
  await mkdir(join(dir, DEFINITION_DIR, "memory"), { recursive: true });
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "AGENTS.md"), `# Repo\n\n${status}\n\nprose below\n`, "utf-8");
  await writeFile(
    join(dir, DEFINITION_DIR, "memory", "decisions.md"),
    "### adr-0001 — first\n\n`accepted` · 2026-01-01\n\n### adr-0002 — second\n\n`accepted` · 2026-01-02\n",
    "utf-8",
  );
  await writeFile(
    join(dir, DEFINITION_DIR, "memory", "signals.jsonl"),
    '{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n',
    "utf-8",
  );
  await writeFile(join(dir, "src", "cli.ts"), "program\n  .command(\"only\")\n", "utf-8");
  return dir;
}

const run = (dir: string, args: string[] = []): Promise<{ code: number; stderr: string }> =>
  exec("npx", ["tsx", SCRIPT, ...args], { cwd: dir })
    .then(({ stderr }) => ({ code: 0, stderr }))
    .catch((e: { code?: number; stderr?: string }) => ({ code: e.code ?? 1, stderr: e.stderr ?? "" }));

const statusIn = async (dir: string): Promise<string> =>
  /^## Status\b.*$/m.exec(await readFile(join(dir, "AGENTS.md"), "utf-8"))?.[0] ?? "";

describe("check-docs-fresh --fix", () => {
  it("writes the real counts into a status line that claims the wrong ones", async () => {
    const dir = await repoWith("## Status — branch `main` · 99 ADRs · 4 signals · 7 commands");

    const { code } = await run(dir, ["--fix"]);

    expect(code).toBe(0);
    expect(await statusIn(dir)).toBe("## Status — branch `main` · 2 ADRs · 3 signals · 1 commands");
  });

  it("leaves the file alone without the flag, and says where the fix is", async () => {
    const line = "## Status — branch `main` · 99 ADRs · 4 signals · 7 commands";
    const dir = await repoWith(line);

    const { code, stderr } = await run(dir);

    expect(code).toBe(1);
    expect(await statusIn(dir)).toBe(line);
    expect(stderr).toContain("npm run fix:docs");
  });

  it("refuses to place a count the line never named", async () => {
    const line = "## Status — branch `main` · 99 ADRs · 4 signals";
    const dir = await repoWith(line);

    const { code, stderr } = await run(dir, ["--fix"]);

    expect(code).toBe(1);
    expect(await statusIn(dir)).toBe(line);
    expect(stderr).toContain("does not name");
  });
});
