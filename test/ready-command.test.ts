/**
 * `wst ready` against real repositories.
 *
 * The scope resolution is unit-tested over facts; this asks whether the adapter
 * gathers those facts correctly from git, and whether the four semantic results
 * come out of situations an agent actually lands in. Staged, unstaged and
 * untracked work are three different git states that no single diff reports, and
 * a unit test over a fact object cannot tell whether the adapter found them.
 *
 * No network: every repo here is local, and `ready` never fetches.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReady } from "../src/commands/ready.js";
import { gitEnv } from "../src/shell/git.js";
import { tempDir } from "./tmp.js";

const exec = promisify(execFile);

let out: string[];
let err: string[];
beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
});
afterEach(() => void vi.restoreAllMocks());

const said = (): string => `${out.join("\n")}\n${err.join("\n")}`;

const ENV = {
  ...gitEnv(),
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@e",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@e",
};

const git = async (dir: string, ...args: string[]): Promise<void> => {
  await exec("git", args, { cwd: dir, env: ENV });
};

/** A repo with `.wst/` holding one check that always passes, and one commit. */
async function repo(defaultBranch = "main"): Promise<string> {
  const dir = await tempDir("wst-ready-");
  await git(dir, "init", "-q", "-b", defaultBranch);
  await mkdir(join(dir, ".wst/checks"), { recursive: true });
  await writeFile(join(dir, ".wst/wst.yaml"), "version: 0\nbackend: files\n", "utf-8");
  await writeFile(
    join(dir, ".wst/triage.yaml"),
    'version: 1\nrules:\n  - glob: "src/**"\n    tier: light\n    reason: >-\n      Application code.\n',
    "utf-8",
  );
  await writeFile(
    join(dir, ".wst/checks/always.md"),
    [
      "---",
      "id: always",
      "description: A check that passes, so a run has something in it.",
      "kind: deterministic",
      "severity: block",
      "tiers: [strict, light]",
      'include: ["src/**"]',
      'command: "node -e \\"process.exit(0)\\""',
      "origin: []",
      "version: 1",
      "---",
      "",
      "Passes.",
    ].join("\n"),
    "utf-8",
  );
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src/a.ts"), "export const a = 1;\n", "utf-8");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-qm", "init");
  return dir;
}

describe("wst ready — the states an agent's worktree is actually in", () => {
  it("verifies an unstaged change on the default branch", async () => {
    const dir = await repo();
    await writeFile(join(dir, "src/a.ts"), "export const a = 2;\n", "utf-8");

    expect(await runReady({}, dir)).toBe(0);
    expect(said()).toContain("Ready");
    expect(said()).toMatch(/unstaged\s+src\/a\.ts/);
  });

  it("verifies a staged change, and says it was staged", async () => {
    const dir = await repo();
    await writeFile(join(dir, "src/b.ts"), "export const b = 1;\n", "utf-8");
    await git(dir, "add", "src/b.ts");

    expect(await runReady({}, dir)).toBe(0);
    expect(said()).toMatch(/staged\s+src\/b\.ts/);
  });

  it("verifies an untracked file, which no diff reports", async () => {
    // The one an agent forgets. A check that never sees a new file reports on a
    // change that is not the one that was made.
    const dir = await repo();
    await writeFile(join(dir, "src/new.ts"), "export const n = 1;\n", "utf-8");

    expect(await runReady({}, dir)).toBe(0);
    expect(said()).toMatch(/untracked\s+src\/new\.ts/);
  });

  it("includes branch commits AND working-tree changes at once", async () => {
    const dir = await repo();
    await git(dir, "checkout", "-q", "-b", "feat/x");
    await writeFile(join(dir, "src/committed.ts"), "export const c = 1;\n", "utf-8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "feat: one");
    await writeFile(join(dir, "src/loose.ts"), "export const l = 1;\n", "utf-8");

    expect(await runReady({}, dir)).toBe(0);
    const text = said();
    expect(text).toMatch(/committed\s+src\/committed\.ts/);
    expect(text).toMatch(/untracked\s+src\/loose\.ts/);
  });

  it("resolves against `master` where that is the default branch", async () => {
    const dir = await repo("master");
    await git(dir, "checkout", "-q", "-b", "feat/y");
    await writeFile(join(dir, "src/a.ts"), "export const a = 3;\n", "utf-8");

    expect(await runReady({}, dir)).toBe(0);
    expect(said()).toContain("master");
  });

  it("finds work outside the directory it was run from", async () => {
    // Run from a subdirectory this reported NO_CHANGES over a repo with an
    // untracked file one directory over: `ls-files --others` answers relative to
    // the process cwd, and the other three git calls do not.
    const dir = await repo();
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "sub/keep.ts"), "export const k = 1;\n", "utf-8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "sub");
    await writeFile(join(dir, "src/new.ts"), "export const n = 1;\n", "utf-8");

    expect(await runReady({}, join(dir, "sub"))).toBe(0);
    expect(said()).not.toContain("No changes to verify");
    expect(said()).toMatch(/untracked\s+src\/new\.ts/);
  });

  it("says NO_CHANGES on a clean tree, and never says it passed", async () => {
    const dir = await repo();

    expect(await runReady({}, dir)).toBe(0);
    expect(said()).toContain("No changes to verify");
    expect(said().toLowerCase()).not.toContain("passed");
  });

  it("is INCOMPLETE when no check covers what changed", async () => {
    // adr-0021 keeps `gate` at exit 0 here so a hook cannot be made unsatisfiable.
    // Readiness is a different claim, and nothing verified this.
    const dir = await repo();
    await writeFile(join(dir, "README.md"), "# changed\n", "utf-8");

    expect(await runReady({}, dir)).toBe(2);
    expect(said()).toContain("Verification incomplete");
  });

  it("is NOT_READY when a check really fails, and names it", async () => {
    const dir = await repo();
    await writeFile(
      join(dir, ".wst/checks/fails.md"),
      [
        "---",
        "id: fails",
        "description: A check that fails.",
        "kind: deterministic",
        "severity: block",
        "tiers: [strict, light]",
        'include: ["src/**"]',
        'command: "node -e \\"process.exit(1)\\""',
        "origin: []",
        "version: 1",
        "---",
        "",
        "Fails.",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(join(dir, "src/a.ts"), "export const a = 9;\n", "utf-8");

    expect(await runReady({}, dir)).toBe(1);
    expect(said()).toContain("Needs work");
    expect(said()).toContain("fails");
  });

  it("refuses when there is no merge base, rather than diffing unrelated trees", async () => {
    // Found by a cross-vendor review. Two histories that share nothing have no
    // merge base; diffing against the ref anyway compares everything in both and
    // then reports the result as verified.
    const dir = await repo();
    await git(dir, "checkout", "-q", "--orphan", "other");
    await writeFile(join(dir, "src/a.ts"), "export const a = 1;\n", "utf-8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "unrelated");
    await git(dir, "branch", "-q", "-M", "main-2");
    await git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main").catch(() => undefined);

    const code = await runReady({ range: "definitely-not-a-ref" }, dir);
    expect(code).toBe(2);
  });

  it("refuses on a detached HEAD rather than guessing a base", async () => {
    const dir = await repo();
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: dir, env: ENV });
    await git(dir, "checkout", "-q", stdout.trim());

    expect(await runReady({}, dir)).toBe(2);
    expect(said()).toMatch(/detached/i);
  });

  it("reports repo-relative paths even when run from a subdirectory", async () => {
    // Found by running it: the paths git prints are already relative to the root,
    // and relativising them again against the process cwd produced `../../home/...`
    // the moment `ready` ran from anywhere else. Every check's glob is written
    // against the root, so the wrong prefix is a check that matches nothing.
    const dir = await repo();
    await writeFile(join(dir, "src/a.ts"), "export const a = 7;\n", "utf-8");

    await runReady({}, join(dir, "src"));
    expect(said()).toMatch(/unstaged\s+src\/a\.ts/);
    expect(said()).not.toContain("..");
  });

  it("takes a full `a..b` range, which is the CI path", async () => {
    // Found by a cross-vendor review of the whole cut: `--range main..HEAD` was
    // handed to a helper that builds `<base>..HEAD` itself, producing
    // `main..HEAD..HEAD`. git rejects it, so the one documented CI override could
    // not run at all.
    const dir = await repo();
    await git(dir, "checkout", "-q", "-b", "feat/r");
    await writeFile(join(dir, "src/ranged.ts"), "export const r = 1;\n", "utf-8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "feat: ranged");

    expect(await runReady({ range: "main..HEAD" }, dir)).toBe(0);
    expect(said()).toMatch(/committed\s+src\/ranged\.ts/);
    expect(said()).toContain("--range");
  });

  it("names the base ref and the commit it compared against", async () => {
    const dir = await repo();
    await writeFile(join(dir, "src/a.ts"), "export const a = 4;\n", "utf-8");

    await runReady({}, dir);
    expect(said()).toMatch(/base\s+HEAD at [0-9a-f]{8}/);
  });
});

describe("wst ready --json", () => {
  it("carries the semantic result as a field, not as a number to infer from", async () => {
    const dir = await repo();
    await writeFile(join(dir, "src/a.ts"), "export const a = 5;\n", "utf-8");

    await runReady({ json: true }, dir);
    const envelope = JSON.parse(out.join("\n")) as Record<string, unknown>;

    expect(envelope["result"]).toBe("READY");
    for (const field of ["repo", "branch", "base", "tier", "results", "uncovered", "elapsedMs"]) {
      expect(envelope).toHaveProperty(field);
    }
  });

  it("splits the changed paths in the envelope, as the report does", async () => {
    const dir = await repo();
    await writeFile(join(dir, "src/new.ts"), "export const n = 1;\n", "utf-8");

    await runReady({ json: true }, dir);
    const envelope = JSON.parse(out.join("\n")) as Record<string, string[]>;

    expect(envelope["untracked"]).toEqual(["src/new.ts"]);
    expect(envelope["committed"]).toEqual([]);
  });
});
