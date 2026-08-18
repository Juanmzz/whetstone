/**
 * The rest of `src/shell/`, against a real filesystem and a real repository.
 *
 * Same posture as `signals-append.test.ts` and `events-append.test.ts`: these
 * adapters are thin by policy, so what is worth testing is never the return value
 * on the happy path. It is the ANSWER THEY GIVE WHEN SOMETHING IS WRONG — every
 * one of them has a documented reason for degrading the way it does, and every one
 * of those reasons is a sentence about a hole in the gate.
 *
 * Grouped by adapter, and each case names the failure it stands in front of.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { recordCalibration } from "../src/core/calibration/receipt.js";
import { recordPass } from "../src/core/receipts/receipt.js";
import { hashFixtureDir } from "../src/shell/calibration.js";
import { assertWorktreeAt, createGitAdapter } from "../src/shell/git.js";
import { tempDir } from "./tmp.js";
import { describePlugin } from "../src/shell/plugin.js";
import { readReceipt, receiptPath, writeReceipt } from "../src/shell/receipts.js";
import { readCursor, readSignals } from "../src/shell/retro.js";
import { loadRegistry, loadTriageRules, resolveDefinitionRoot } from "../src/shell/sdd.js";
import { createTreehouseAdapter } from "../src/shell/treehouse.js";
import { emptyPath, installFakeBin, restorePath } from "./fake-bin.js";
import { isolateFromInheritedGit } from "./git-env.js";

// Before anything builds a repository. See `git-env.ts`: run from the pre-push
// hook, every temp repo below otherwise inherits the pushing repo's GIT_DIR.
isolateFromInheritedGit();

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]): Promise<unknown> => exec("git", args, { cwd });

const temp = async (prefix: string): Promise<string> =>
  await tempDir(prefix, true);

afterEach(() => restorePath());

// ── git ──────────────────────────────────────────────────────────────────────

describe("the git adapter", () => {
  async function seeded(): Promise<string> {
    const dir = await temp("wst-git-");
    await git(dir, "init", "-q", "-b", "main");
    await git(dir, "config", "user.email", "fixture@example.com");
    await git(dir, "config", "user.name", "fixture");
    await writeFile(join(dir, "a.txt"), "one\n", "utf-8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "seed");
    return dir;
  }

  it("reports a detached HEAD as no branch, never as a branch called HEAD", async () => {
    // `appendSignals` takes this value and OMITS the field when it is null. The
    // literal string "HEAD" would be written into the evidence log as a branch
    // name, and the retro would group unrelated work under it forever.
    const dir = await seeded();
    const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], { cwd: dir });
    await git(dir, "checkout", "-q", head.trim());

    expect(await createGitAdapter(dir).currentBranch()).toBeNull();
  });

  it("reports the branch it is on when it is on one", async () => {
    expect(await createGitAdapter(await seeded()).currentBranch()).toBe("main");
  });

  it("answers null outside a work tree instead of throwing at the command", async () => {
    // Every command starts by asking this. A throw here would be a stack trace
    // where `wst gate` has a sentence explaining that it needs a repository.
    expect(await createGitAdapter(await temp("wst-git-none-")).repoRoot()).toBeNull();
  });

  it("reports a non-ASCII path as itself, not as git's quoted escape", async () => {
    // `core.quotePath` defaults on, so `git diff --name-status` prints
    // "src/se\303\261al.ts" for `src/señal.ts`. Nothing downstream unquotes it,
    // so the path matched no `include` glob, the check never selected it, and the
    // gate reported that nothing applied to the change — for a file that was
    // plainly in `src/`. A blocking check failure exited 0 through this hole.
    const dir = await seeded();
    await writeFile(join(dir, "señal.txt"), "hola\n", "utf-8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "add a non-ascii path");

    const out = await createGitAdapter(dir).diffNameStatus("HEAD~1..HEAD");

    expect(out).toContain("señal.txt");
    expect(out).not.toContain("\\303");
  });

  it("hashes content, so an edited file cannot reuse its receipt", async () => {
    // The receipt mechanism is this hash. If it were a path hash, or stable
    // across edits, every check would be skipped forever after its first pass.
    const dir = await seeded();
    const adapter = createGitAdapter(dir);
    const before = await adapter.hashFile("a.txt");
    await writeFile(join(dir, "a.txt"), "two\n", "utf-8");

    expect(await adapter.hashFile("a.txt")).not.toBe(before);
  });

  it("throws on a range git rejected, instead of reporting an empty diff", async () => {
    // A typo in `--range` produced the same bytes as a range with no changes: the
    // adapter swallowed git's error and `?? ""` turned it into an empty diff. The
    // damage lands hardest in `wst triage`, which answered `off — no files changed`
    // and exit 0 for a range that does not exist. A confident wrong answer is worse
    // than a failure, because only one of them tells you to look at the range.
    //
    // `repoRoot` and `currentBranch` keep swallowing, and that is not an
    // inconsistency: their errors have a meaning ("not a repository", "detached"),
    // and this one does not.
    await expect(createGitAdapter(await seeded()).diffNameStatus("nope..alsonope")).rejects.toThrow(
      /nope\.\.alsonope/,
    );
  });

  it("still reports a genuinely empty diff as empty", async () => {
    // The other side of the line. A clean tree is not an error, and turning it into
    // one would make every gate run on an unchanged range fail.
    expect(await createGitAdapter(await seeded()).diffNameStatus("HEAD")).toBe("");
  });

  it("throws on a file it cannot hash rather than returning something plausible", async () => {
    // The gate catches this and mints NO receipt for the check — resolving
    // toward more verification. A fabricated hash would resolve the other way.
    await expect(createGitAdapter(await seeded()).hashFile("gone.txt")).rejects.toThrow(
      /could not hash/,
    );
  });

  describe("refusing a target that is not what it claims", () => {
    /**
     * `wst prepare` runs `git reset --hard`, `git switch -C` and `ln -sfn` against
     * a leased worktree. Stripping `GIT_*` fixes the leak that was FOUND; this is
     * what survives the next one, a treehouse bug, or a caller passing the wrong
     * string. A destructive command should ask where it is standing.
     */
    it("accepts a directory that really is the root of the repository it resolves to", async () => {
      const dir = await seeded();
      await expect(assertWorktreeAt(dir)).resolves.toBeUndefined();
    });

    it("refuses a directory git resolves somewhere else", async () => {
      // A subdirectory: git answers with the repo root, not with the path given.
      // Same shape as an inherited GIT_DIR pointing at another repository.
      const dir = await seeded();
      await mkdir(join(dir, "sub"), { recursive: true });
      await expect(assertWorktreeAt(join(dir, "sub"))).rejects.toThrow(/not what it claims/);
    });

    it("refuses a directory that is no repository at all", async () => {
      await expect(assertWorktreeAt(await temp("wst-none-"))).rejects.toThrow(
        /not a git worktree/,
      );
    });
  });

  describe("an inherited git environment", () => {
    /**
     * `sig-82dec46b`, and it is not a hypothetical.
     *
     * Git exports `GIT_DIR` and friends to everything a hook spawns, and the
     * pre-push hook spawns `wst gate`. The adapter took a `cwd` and inherited the
     * rest of the environment, so a command pointed at directory A read repository
     * B — and worse than read: the main repository's INDEX was written with another
     * worktree's file state, twice, staging a revert of ~3,500 lines that a
     * `git commit` would have made permanent. `core.bare` flipped to `true` in the
     * same incident.
     *
     * The cwd is the adapter's whole contract. An environment variable that
     * silently overrides it makes the parameter a suggestion.
     */
    const REDIRECTORS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"];

    afterEach(() => {
      for (const key of REDIRECTORS) delete process.env[key];
    });

    it("reads the directory it was given, not the repository GIT_DIR points at", async () => {
      const [mine, theirs] = [await seeded(), await seeded()];
      process.env["GIT_DIR"] = join(theirs, ".git");
      process.env["GIT_WORK_TREE"] = theirs;

      expect(await createGitAdapter(mine).repoRoot()).toBe(mine);
    });


    it("still reports no repository when there is none, whatever GIT_DIR claims", async () => {
      // Without this, a hook's environment makes every directory on the machine
      // look like a repository, and `wst gate` cheerfully gates the wrong diff.
      const theirs = await seeded();
      process.env["GIT_DIR"] = join(theirs, ".git");
      process.env["GIT_WORK_TREE"] = theirs;

      expect(await createGitAdapter(await temp("wst-git-none-")).repoRoot()).toBeNull();
    });
  });
});

// ── receipts ─────────────────────────────────────────────────────────────────

describe("the receipt store", () => {
  const receipt = recordPass({
    checkId: "test",
    check: { version: 1, command: "npm test" },
    files: [{ path: "src/app.ts", hash: "a".repeat(40) }],
    at: new Date("2026-08-12T10:00:00.000Z"),
  });

  it("round-trips what it wrote, or the cache would never hit", async () => {
    const root = await temp("wst-receipts-");
    await writeReceipt(root, receipt);
    expect(await readReceipt(root, "test")).toEqual(receipt);
  });

  it("reads a missing receipt as a cache miss", async () => {
    expect(await readReceipt(await temp("wst-receipts-"), "test")).toBeNull();
  });

  it("reads a receipt written under another format as a miss", async () => {
    // A receipt authorises skipping a check. Every failure to validate one has to
    // degrade to a miss: that costs one re-run, and the other direction is a
    // silent hole in the gate that nobody can see from the outside. The format tag
    // is the version of that promise — a v2 record read by a v1 parser would be
    // misinterpreted rather than re-earned.
    const root = await temp("wst-receipts-");
    await writeReceipt(root, receipt);
    await writeFile(receiptPath(root, "test"), JSON.stringify({ ...receipt, format: 2 }), "utf-8");
    expect(await readReceipt(root, "test")).toBeNull();
  });

  it("reads a receipt claiming a failure as a miss — there is no such record", async () => {
    const root = await temp("wst-receipts-");
    await writeReceipt(root, receipt);
    await writeFile(
      receiptPath(root, "test"),
      JSON.stringify({ ...receipt, outcome: "fail" }),
      "utf-8",
    );
    expect(await readReceipt(root, "test")).toBeNull();
  });

  it("returns a well-formed receipt whose hash was forged — that is not its job", async () => {
    // Deliberately pinning the LIMIT of this adapter, not a virtue of it. The
    // store validates SHAPE, not provenance; a forged `inputHash` is a valid
    // string and comes back intact. What defeats it is `shouldSkip` recomputing
    // the hash one layer up — and, for a gate judging someone else's tree,
    // `--no-receipts`, which exists precisely because this file cannot tell who
    // wrote what it reads.
    const root = await temp("wst-receipts-");
    await writeReceipt(root, receipt);
    await writeFile(
      receiptPath(root, "test"),
      JSON.stringify({ ...receipt, inputHash: "forged" }),
      "utf-8",
    );
    expect((await readReceipt(root, "test"))?.inputHash).toBe("forged");
  });

  it("reads a truncated receipt as a miss rather than crashing the gate", async () => {
    const root = await temp("wst-receipts-");
    await mkdir(join(root, "receipts"), { recursive: true });
    await writeFile(join(root, "receipts/test.json"), '{"format":1,"che', "utf-8");
    expect(await readReceipt(root, "test")).toBeNull();
  });

  it("refuses to build a path out of a check id that is not kebab-case", async () => {
    // The id reaches the filesystem. `../../etc/passwd` is a check id as far as
    // a YAML file is concerned.
    expect(() => receiptPath("/tmp/x", "../../etc/passwd")).toThrow(/kebab-case/);
  });
});

// ── calibration ──────────────────────────────────────────────────────────────

describe("hashing the fixture set", () => {
  /** Two diffs and a manifest — the smallest thing a lens can be measured against. */
  async function fixtures(): Promise<string> {
    const dir = await temp("wst-fixtures-");
    await writeFile(join(dir, "good.diff"), "--- a\n+++ b\n+const x = 1;\n", "utf-8");
    await writeFile(join(dir, "bad.diff"), "--- a\n+++ b\n+const y = 2;\n", "utf-8");
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({
        fixtures: [
          { file: "good.diff", expect: "pass" },
          { file: "bad.diff", expect: "fail" },
        ],
      }),
      "utf-8",
    );
    return dir;
  }

  it("changes when a fixture's CONTENT changes", async () => {
    // The whole mechanism: a receipt is bound to the set it was measured
    // against, so editing a fixture breaks the binding by itself rather than
    // relying on someone remembering to re-measure.
    const dir = await fixtures();
    const before = await hashFixtureDir(dir);
    await writeFile(join(dir, "good.diff"), "--- a\n+++ b\n+const x = 99;\n", "utf-8");

    expect(await hashFixtureDir(dir)).not.toBe(before);
    expect(before).not.toBeNull();
  });

  it("changes when only the GROUND TRUTH is flipped", async () => {
    // Same bytes, opposite expectations. A hash over content alone would call
    // this the same measurement, and a receipt would carry across a set whose
    // answers were inverted.
    const dir = await fixtures();
    const before = await hashFixtureDir(dir);
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({
        fixtures: [
          { file: "good.diff", expect: "fail" },
          { file: "bad.diff", expect: "pass" },
        ],
      }),
      "utf-8",
    );

    expect(await hashFixtureDir(dir)).not.toBe(before);
  });

  it("denies when the manifest names a fixture that is gone", async () => {
    const dir = await fixtures();
    await rm(join(dir, "bad.diff"));
    expect(await hashFixtureDir(dir)).toBeNull();
  });

  it("denies when a fixture on disk is not in the manifest", async () => {
    // An unlabelled diff means the set is not the one that was measured — and a
    // lens quietly measured against fewer cases than it faces is the failure the
    // receipt exists to make impossible.
    const dir = await fixtures();
    await writeFile(join(dir, "extra.diff"), "--- a\n+++ b\n+const z = 3;\n", "utf-8");
    expect(await hashFixtureDir(dir)).toBeNull();
  });

  it("denies a directory it cannot read at all", async () => {
    expect(await hashFixtureDir(join(await temp("wst-fixtures-"), "nope"))).toBeNull();
  });
});

// ── the .wst/ loader ─────────────────────────────────────────────────────────

describe("loading triage rules", () => {
  it("falls back to the built-in ruleset when the project has written none", async () => {
    const { rules, origin } = await loadTriageRules(await temp("wst-sdd-"));
    expect(rules.length).toBeGreaterThan(0);
    expect(origin).toBe("built-in defaults");
  });

  it("throws on a malformed file instead of silently using the defaults", async () => {
    // Falling back here would ignore rules somebody deliberately wrote, and
    // every file they covered would be triaged at the wrong discipline with
    // nothing to show for it.
    const root = await temp("wst-sdd-");
    await writeFile(join(root, "triage.yaml"), "version: 1\nrules: []\n", "utf-8");
    await expect(loadTriageRules(root)).rejects.toThrow(/invalid triage rules/);
  });

  it("throws when the file exists but cannot be read", async () => {
    // ONLY a missing file falls back. A `triage.yaml` that is a directory — or
    // unreadable for any other reason — is a project whose rules exist and could
    // not be loaded, which is not the same as a project that has none.
    const root = await temp("wst-sdd-");
    await mkdir(join(root, "triage.yaml"), { recursive: true });
    await expect(loadTriageRules(root)).rejects.toThrow();
  });
});

describe("loading the check registry", () => {
  const lens = (severity: string): string => `---
id: correctness
description: A review lens.
kind: agent-lens
severity: ${severity}
tiers: [strict]
include: ["src/**"]
review_lens: Review this diff for correctness.
calibration:
  fixtures: fixtures
version: 1
---

Body.
`;

  it("treats a repository with no checks/ as an empty registry, not an error", async () => {
    // `wst init` has to work in a repo that has neither.
    expect((await loadRegistry(await temp("wst-registry-"))).all).toEqual([]);
  });

  it("ignores the compiled index and anything else underscore-prefixed", async () => {
    // `_index.json` is regenerable cache written INTO the same directory it is
    // loaded from. Reading it back as a check would fail the whole registry.
    const root = await temp("wst-registry-");
    await mkdir(join(root, "checks"), { recursive: true });
    await writeFile(join(root, "checks/_index.json"), "{}", "utf-8");
    await writeFile(join(root, "checks/_draft.md"), "not a check at all", "utf-8");
    expect((await loadRegistry(root)).all).toEqual([]);
  });

  it("refuses to load a lens that declares block with no receipt beside it", async () => {
    // Non-negotiable 2. The evidence is gathered HERE — an adapter that forgot
    // to pass it would hand every uncalibrated lens blocking authority, so
    // absent evidence has to deny, and this is the test that says it does.
    const root = await temp("wst-registry-");
    await mkdir(join(root, "checks"), { recursive: true });
    await writeFile(join(root, "checks/correctness.md"), lens("block"), "utf-8");

    await expect(loadRegistry(root)).rejects.toThrow(/has not earned it/);
  });

  it("loads the same lens at warn, because warn was never in question", async () => {
    const root = await temp("wst-registry-");
    await mkdir(join(root, "checks"), { recursive: true });
    await writeFile(join(root, "checks/correctness.md"), lens("warn"), "utf-8");
    expect((await loadRegistry(root)).all.map((c) => c.id)).toEqual(["correctness"]);
  });

  /**
   * The full mechanism through the adapter: a receipt whose hashes are recomputed
   * from the fixture set AS IT EXISTS NOW. Minted with `recordCalibration`, which
   * is the only way to make one, so the test cannot fabricate a receipt the
   * loader would accept any more than a human could.
   */
  describe("a lens that has actually been measured", () => {
    const LENS_TEXT = "Review this diff for correctness.";

    async function measured(): Promise<{ root: string; fixtureDir: string }> {
      const repoRoot = await temp("wst-measured-");
      const root = join(repoRoot, ".wst");
      const fixtureDir = join(repoRoot, "fixtures");
      await mkdir(join(root, "checks"), { recursive: true });
      await mkdir(fixtureDir, { recursive: true });

      const content = "--- a\n+++ b\n+const x = 1;\n";
      await writeFile(join(fixtureDir, "good.diff"), content, "utf-8");
      await writeFile(
        join(fixtureDir, "manifest.json"),
        JSON.stringify({ fixtures: [{ file: "good.diff", expect: "pass" }] }),
        "utf-8",
      );
      await writeFile(join(root, "checks/correctness.md"), lens("block"), "utf-8");

      const { createHash } = await import("node:crypto");
      await writeFile(
        join(root, "checks/correctness.calibration.json"),
        JSON.stringify(
          recordCalibration({
            checkId: "correctness",
            lens: LENS_TEXT,
            fixtures: [
              {
                path: "good.diff",
                expected: "pass",
                hash: createHash("sha256").update(content, "utf8").digest("hex"),
              },
            ],
            model: "opus",
            runtime: { name: "claude", version: "2.1.226" },
            results: [{ fixture: "good.diff", expected: "pass", got: Array(10).fill("pass") }],
            at: new Date("2026-08-01T00:00:00.000Z"),
          }),
        ),
        "utf-8",
      );

      return { root, fixtureDir };
    }

    it("holds block, because the hashes still describe what is on disk", async () => {
      const { root } = await measured();
      const registry = await loadRegistry(root);
      expect(registry.index.blocking).toEqual(["correctness"]);
    });

    it("loses it the moment a fixture is edited underneath it", async () => {
      // No version bump, no re-measurement, no human remembering anything: the
      // binding breaks by itself. This is the difference between "measured" and
      // "claims to have been measured", and it only works if the ADAPTER hashes
      // the directory as it stands rather than trusting the receipt's own copy.
      const { root, fixtureDir } = await measured();
      await writeFile(join(fixtureDir, "good.diff"), "--- a\n+++ b\n+const x = 2;\n", "utf-8");

      await expect(loadRegistry(root)).rejects.toThrow(/fixture set changed/);
    });
  });
});

describe("resolving the definition directory", () => {
  it("names the pre-ADR-0012 directory instead of reporting no checks", async () => {
    // ADR-0012 chose a clean rename with no dual path. The cost lands here: a
    // repo installed before it would otherwise get an empty registry, which is a
    // gate that reports fine while enforcing nothing.
    const repoRoot = await temp("wst-legacy-");
    await mkdir(join(repoRoot, ".sdd"), { recursive: true });
    await expect(resolveDefinitionRoot(repoRoot)).rejects.toThrow(/\.sdd/);
  });

  it("returns the path for a repo that has neither, since init needs that", async () => {
    const repoRoot = await temp("wst-neither-");
    expect(await resolveDefinitionRoot(repoRoot)).toBe(join(repoRoot, ".wst"));
  });
});

// ── the retro's reading side ─────────────────────────────────────────────────

describe("the retro cursor", () => {
  it("takes the LAST cursor in the log, not the first", async () => {
    // The retro log grows by appending. Reading the first cursor would make every
    // retro reprocess every signal since the beginning, and recurrence — the one
    // thing that makes a cluster actionable — would inflate on every run.
    const root = await temp("wst-retro-");
    await mkdir(join(root, "memory"), { recursive: true });
    await writeFile(
      join(root, "memory/retro-log.md"),
      "## retro-0001\ncursor: sig-0010\n\n## retro-0002\ncursor: sig-0026\n",
      "utf-8",
    );
    expect(await readCursor(root)).toBe("sig-0026");
  });

  it("is null when no retro has run", async () => {
    expect(await readCursor(await temp("wst-retro-"))).toBeNull();
  });

  it("reads a missing signal log as empty, and a corrupt one as a stop", async () => {
    // Clustering over a subset while reporting it processed everything is worse
    // than stopping: the proposal would cite evidence that was never read.
    const root = await temp("wst-retro-");
    expect(await readSignals(root)).toEqual([]);

    await mkdir(join(root, "memory"), { recursive: true });
    await writeFile(join(root, "memory/signals.jsonl"), "{ not json\n", "utf-8");
    await expect(readSignals(root)).rejects.toThrow();
  });
});

// ── the harness plugin ───────────────────────────────────────────────────────

describe("describing the plugin install", () => {
  const rows = (...entries: unknown[]): string => JSON.stringify(entries);

  it("matches on the name, so a marketplace suffix does not hide the install", async () => {
    // Plugin ids are `name@marketplace`. An exact-id match would report a
    // correctly installed plugin as absent and send a human to reinstall it.
    await installFakeBin("claude", {
      stdout: rows({ id: "whetstone@juanmzz", enabled: true }),
    });
    expect(await describePlugin()).toBe("enabled");
  });

  it("distinguishes installed-but-off from not installed", async () => {
    await installFakeBin("claude", { stdout: rows({ id: "whetstone@x", enabled: false }) });
    expect(await describePlugin()).toBe("disabled");

    await installFakeBin("claude", { stdout: rows({ id: "something-else@x", enabled: true }) });
    expect(await describePlugin()).toBe("absent");
  });

  it("says unknown — not absent — when it could not ask", async () => {
    // "absent" is a claim about the user's machine. Status reporting a wrong
    // answer confidently is the exact failure it exists to fix.
    emptyPath();
    expect(await describePlugin()).toBe("unknown");
  });

  it("says unknown when the answer is not a list of plugins", async () => {
    await installFakeBin("claude", { stdout: "not json" });
    expect(await describePlugin()).toBe("unknown");

    await installFakeBin("claude", { stdout: '{"plugins":[]}' });
    expect(await describePlugin()).toBe("unknown");
  });
});

// ── treehouse ────────────────────────────────────────────────────────────────

describe("the treehouse adapter", () => {
  it("takes the worktree path from the LAST line, past any progress output", async () => {
    // `treehouse get --lease` prints the path; anything it prints before that is
    // noise. Reading the first line would hand `wst run` a status message as a
    // directory, and the crewmate would be dispatched somewhere that is not a
    // worktree.
    await installFakeBin("treehouse", {
      stdout: "leasing...\npreparing worktree\n/tmp/pool/wt-3\n",
    });
    expect(await createTreehouseAdapter("/tmp").lease("holder")).toEqual({
      path: "/tmp/pool/wt-3",
      holder: "holder",
    });
  });

  it("throws when it printed no path at all", async () => {
    // An empty string here would become `cwd` for the crewmate, which resolves to
    // the ORCHESTRATOR's directory — an agent with tools, editing the repo that
    // dispatched it, outside any worktree.
    await installFakeBin("treehouse", { stdout: "\n" });
    await expect(createTreehouseAdapter("/tmp").lease("holder")).rejects.toThrow(/no path/);
  });

  it("reports itself unavailable rather than throwing when it is not installed", async () => {
    // `wst run` prints an install hint on false. An exception would print a stack
    // trace instead.
    emptyPath();
    expect(await createTreehouseAdapter("/tmp").available()).toBe(false);
  });

  it("reports itself available when the binary answers", async () => {
    await installFakeBin("treehouse", { stdout: "treehouse 0.4.0\n" });
    expect(await createTreehouseAdapter("/tmp").available()).toBe(true);
  });
});

// ── a guard on the fixtures above ────────────────────────────────────────────

describe("the temp repositories these tests build", () => {
  it("are real repositories, or every git assertion above is vacuous", async () => {
    const dir = await temp("wst-git-sanity-");
    await git(dir, "init", "-q", "-b", "main");
    expect(await readFile(join(dir, ".git/HEAD"), "utf-8")).toMatch(/refs\/heads\/main/);
  });
});
