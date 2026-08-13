/**
 * The composition roots other than `wst gate`, at their boundary.
 *
 * `src/commands/` is light tier and the header of every file here says the same
 * thing: build the adapters, call the core, print. The cases below are the ones
 * where that is not quite the whole truth — an ordering, a guard, or a refusal to
 * spend money — and each of them fails silently if it breaks:
 *
 *  - `wst init` checks for collisions BEFORE the writer, because the writer is
 *    `mkdir -p` + `writeFile` and has no existence check of its own.
 *  - `--dry-run` on `prepare` and `retro` must spawn nothing. A dry run that costs
 *    money is not a dry run, and nothing about the output would say so.
 *  - the checks a crewmate is told about, and the paths it is told are dangerous,
 *    are DERIVED from the project's own registry and rules (sig-0041).
 *  - `check` and `triage` must fail loudly on configuration they cannot read,
 *    because a registry that did not load is an ungated change.
 */

import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCheck } from "../src/commands/check.js";
import { runGate } from "../src/commands/gate.js";
import { runInit } from "../src/commands/init.js";
import { runRetro } from "../src/commands/retro.js";
import { runPrepare } from "../src/commands/prepare.js";
import { runStatus } from "../src/commands/status.js";
import { runTriage } from "../src/commands/triage.js";
import { installFakeBin, restorePath, type FakeBin } from "./fake-bin.js";
import { isolateFromInheritedGit } from "./git-env.js";

// Before anything builds a repository. See `git-env.ts`: run from the pre-push
// hook, every temp repo below otherwise inherits the pushing repo's GIT_DIR.
isolateFromInheritedGit();

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]): Promise<unknown> => exec("git", args, { cwd });

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
});

afterEach(() => {
  vi.restoreAllMocks();
  restorePath();
});

const stdout = (): string => out.join("\n");
const stderr = (): string => err.join("\n");
const json = (): Record<string, unknown> =>
  JSON.parse(stdout().slice(stdout().indexOf("{"))) as Record<string, unknown>;

const CHECK = `---
id: green
description: A deterministic check named green.
kind: deterministic
severity: block
tiers: [light, strict]
include: ["src/**"]
command: 'exit 0'
version: 1
---

Fixture check.
`;

const TRIAGE = `version: 1
rules:
  - glob: "migrations/**"
    tier: strict
    reason: Schema changes are irreversible in production, so they earn full TDD.
  - glob: "src/**"
    tier: light
    reason: The sample application in this fixture repository.
`;

interface RepoOptions {
  readonly triage?: string | null;
  readonly checks?: Readonly<Record<string, string>>;
  /** Leave `.wst/` out of the commit, the way an unfinished `wst init` does. */
  readonly untrackedDefinition?: boolean;
}

async function repo(options: RepoOptions = {}): Promise<string> {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), "wst-cmd-")));
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "config", "user.email", "fixture@example.com");
  await git(dir, "config", "user.name", "fixture");

  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src/app.ts"), "export const answer = 1;\n", "utf-8");

  // A path the PROJECT calls strict and the built-in defaults have never heard
  // of. It is what makes "triage and gate agree" a question with two possible
  // answers rather than a coincidence of two rulesets that happen to match.
  await mkdir(join(dir, "migrations"), { recursive: true });
  await writeFile(join(dir, "migrations/001.sql"), "select 1;\n", "utf-8");

  await mkdir(join(dir, ".wst/checks"), { recursive: true });
  if (options.triage !== null) {
    await writeFile(join(dir, ".wst/triage.yaml"), options.triage ?? TRIAGE, "utf-8");
  }
  for (const [name, body] of Object.entries(options.checks ?? { "green.md": CHECK })) {
    await writeFile(join(dir, ".wst/checks", name), body, "utf-8");
  }

  if (options.untrackedDefinition === true) {
    await writeFile(join(dir, ".git/info/exclude"), ".wst/\n", "utf-8");
  }
  await git(dir, "add", "-A");
  await git(dir, "commit", "-qm", "seed");

  await writeFile(join(dir, "src/app.ts"), "export const answer = 42;\n", "utf-8");
  await writeFile(join(dir, "migrations/001.sql"), "select 2;\n", "utf-8");
  return dir;
}

// ── wst check ────────────────────────────────────────────────────────────────

describe("wst check", () => {
  it("fails loudly on a registry it cannot parse", async () => {
    // An unloadable registry means an ungated change. Printing "no checks
    // registered" here would be the same sentence a clean, empty repo gets.
    const dir = await repo({ checks: { "green.md": "no frontmatter\n" } });
    expect(await runCheck({}, dir)).toBe(1);
    expect(stderr()).toMatch(/check registry failed to load/);
  });

  it("tells an empty repo where checks go instead of reporting nothing", async () => {
    const dir = await repo({ checks: {} });
    expect(await runCheck({}, dir)).toBe(0);
    expect(stdout()).toMatch(/no checks registered/);
  });

  it("compiles an index that agrees with the registry it came from", async () => {
    // `_index.json` is a cache, and a cache that disagrees with its source is
    // worse than none: the gate reads the registry, other tools read the index.
    const dir = await repo();
    await runCheck({ compile: true }, dir);
    const index = JSON.parse(await readFile(join(dir, ".wst/checks/_index.json"), "utf-8")) as {
      blocking: string[];
      checks: { id: string }[];
    };

    expect(index.blocking).toEqual(["green"]);
    expect(index.checks.map((c) => c.id)).toEqual(["green"]);
  });
});

// ── wst triage ───────────────────────────────────────────────────────────────

describe("wst triage", () => {
  it("fails loudly rather than falling back on rules it could not parse", async () => {
    const dir = await repo({ triage: "version: 1\nrules: []\n" });
    expect(await runTriage({ range: "HEAD" }, dir)).toBe(1);
    expect(stderr()).toMatch(/triage configuration failed to load/);
  });

  it("routes from the project's file, and says which file it used", async () => {
    // A gate that routed from anything other than the project's own rules would
    // make them decorative exactly where they matter. The origin is how a reader
    // tells "your rules ran" from "the built-in defaults ran".
    const dir = await repo();
    await runTriage({ range: "HEAD", json: true }, dir);
    expect(String(json()["rules"])).toContain("triage.yaml");
  });

  it("agrees with the gate about the tier of the same change", async () => {
    // The two commands load the rules through DIFFERENT code paths —
    // `commands/triage.ts` has its own loader, `commands/gate.ts` goes through
    // `shell/sdd.ts`. `sdd.ts`'s header says they must route identically: two
    // commands that disagree about a tier disagree about which checks apply.
    //
    // The diff touches `migrations/`, which the project calls strict and the
    // built-in defaults do not mention — so a command that quietly fell back to
    // the defaults answers `light` here and is caught.
    const dir = await repo();
    await runTriage({ range: "HEAD", json: true }, dir);
    const triaged = (json()["triage"] as { tier: string }).tier;
    expect(triaged).toBe("strict");

    out.length = 0;
    await runGate({ range: "HEAD", noLens: true, noEmit: true, json: true }, dir);
    expect(json()["tier"]).toBe(triaged);
  });
});

// ── wst status ───────────────────────────────────────────────────────────────

describe("wst status", () => {
  /** A plugin install that is enabled, so the rows below are reachable. */
  async function withPlugin(): Promise<FakeBin> {
    const fake = await installFakeBin("claude", {
      stdout: JSON.stringify([{ id: "whetstone@juanmzz", enabled: true }]),
    });
    await fake.respondWith({ stdout: "2.1.226 (Claude Code)\n" }, "--version");
    return fake;
  }

  it("warns that an UNTRACKED .wst/ is inert in every worktree cut from here", async () => {
    // sig-0044, and the reason it took a field report to find: `.wst/` is present
    // here and absent in every worktree, so the plugin's hooks silently do
    // nothing in exactly the places `wst prepare` sends work. Nothing else reports it.
    await withPlugin();
    const dir = await repo({ untrackedDefinition: true });
    await runStatus(dir);

    expect(stdout()).toMatch(/not tracked by git/);
  });

  it("says nothing of the kind once it is committed", async () => {
    await withPlugin();
    await runStatus(await repo());
    expect(stdout()).not.toMatch(/not tracked by git/);
  });

  it("is NOT ready, and exits nonzero, in a repo with no definition directory", async () => {
    // The exit code is what a script reads. Reporting problems on stdout while
    // exiting 0 would make `wst status` unusable in CI.
    await withPlugin();
    const bare = realpathSync(await mkdtemp(join(tmpdir(), "wst-status-")));
    await git(bare, "init", "-q", "-b", "main");

    expect(await runStatus(bare)).toBe(1);
    expect(stdout()).toMatch(/NOT ready/);
  });
});

// ── wst prepare --dry-run ────────────────────────────────────────────────────────

describe("wst prepare --dry-run", () => {
  it("spends nothing and leases nothing", async () => {
    // The flag exists so a charter can be read before any of it is real. A
    // dry run that leased a worktree or spawned an agent would cost money and
    // print exactly the same thing.
    const claude = await installFakeBin("claude", { stdout: "{}" });
    const treehouse = await installFakeBin("treehouse", { stdout: "/tmp/wt\n" });

    expect(await runPrepare({ task: "add a health endpoint", dryRun: true }, await repo())).toBe(0);
    expect(await claude.invocations()).toEqual([]);
    expect(await treehouse.invocations()).toEqual([]);
  });

  it("names the strict paths from THIS project's rules, not Whetstone's", async () => {
    // sig-0041: the charter hardcoded Whetstone's own three directories, so a
    // crewmate in another repo was warned about paths it would never touch and
    // told nothing about the ones that mattered.
    await runPrepare({ task: "alter a table", dryRun: true }, await repo());

    expect(stdout()).toContain("migrations/**");
    expect(stdout()).not.toContain("src/core/**");
  });

  it("names the checks its work will be gated by", async () => {
    // A crewmate that does not know what will judge it cannot check its own work
    // before handing it over.
    await runPrepare({ task: "add a health endpoint", dryRun: true }, await repo());
    expect(stdout()).toContain("green");
  });
});

// ── wst retro --dry-run ──────────────────────────────────────────────────────

describe("wst retro", () => {
  const signal = (id: string, type: string): string =>
    JSON.stringify({
      id,
      ts: "2026-08-01T00:00:00.000Z",
      type,
      phase: "verify",
      severity: "medium",
      detail: `something happened (${id})`,
      rule_affected: [],
    });

  async function withSignals(...lines: string[]): Promise<string> {
    const dir = await repo();
    await mkdir(join(dir, ".wst/memory"), { recursive: true });
    await writeFile(join(dir, ".wst/memory/signals.jsonl"), `${lines.join("\n")}\n`, "utf-8");
    return dir;
  }

  it("clusters without calling a model, and writes no proposal", async () => {
    // The retro's one job is to propose; `--dry-run` is what lets someone see the
    // clustering without paying for the proposals. A model call here would be
    // billed for output nobody asked for.
    const claude = await installFakeBin("claude", { stdout: "{}" });
    const dir = await withSignals(signal("sig-0001", "triage-miss"), signal("sig-0002", "triage-miss"));

    expect(await runRetro({ dryRun: true }, dir)).toBe(0);
    expect(await claude.invocations()).toEqual([]);
    await expect(readFile(join(dir, ".wst/memory/proposals"), "utf-8")).rejects.toThrow();
    expect(stdout()).toMatch(/--dry-run: clustered only/);
  });

  it("stops at the cursor rather than reprocessing a log it has already read", async () => {
    // Recurrence is what makes a cluster actionable. Reprocessing old signals
    // every run would manufacture the recurrence it is supposed to observe.
    const claude = await installFakeBin("claude", { stdout: "{}" });
    const dir = await withSignals(signal("sig-0001", "triage-miss"));
    await mkdir(join(dir, ".wst/memory"), { recursive: true });
    await writeFile(join(dir, ".wst/memory/retro-log.md"), "## retro-0001\ncursor: sig-0001\n", "utf-8");

    expect(await runRetro({}, dir)).toBe(0);
    expect(stdout()).toMatch(/nothing new since the last retro/);
    expect(await claude.invocations()).toEqual([]);
  });
});

// ── wst init ─────────────────────────────────────────────────────────────────

describe("wst init", () => {
  const PURPOSE = "A fixture service that does nothing in particular.";

  async function bare(): Promise<string> {
    const dir = realpathSync(await mkdtemp(join(tmpdir(), "wst-init-")));
    await git(dir, "init", "-q", "-b", "main");
    await writeFile(join(dir, "package.json"), '{"name":"fixture"}\n', "utf-8");
    return dir;
  }

  it("refuses to overwrite a file it did not write, and destroys nothing", async () => {
    // The writer is `mkdir -p` + `writeFile` with no existence check of its own,
    // so by the time it runs the previous contents are already gone. This guard
    // is the only thing standing between `wst init` and someone's AGENTS.md.
    const dir = await bare();
    await writeFile(join(dir, "AGENTS.md"), "# mine, hand-written\n", "utf-8");

    expect(await runInit({ purpose: PURPOSE }, dir)).toBe(1);
    expect(await readFile(join(dir, "AGENTS.md"), "utf-8")).toBe("# mine, hand-written\n");
  });

  it("names what --force would destroy instead of doing it silently", async () => {
    const dir = await bare();
    await writeFile(join(dir, "AGENTS.md"), "# mine\n", "utf-8");
    await runInit({ purpose: PURPOSE }, dir);
    expect(stderr()).toContain("AGENTS.md");
  });

  it("writes nothing under --dry-run", async () => {
    const dir = await bare();
    expect(await runInit({ purpose: PURPOSE, dryRun: true }, dir)).toBe(0);
    await expect(readFile(join(dir, ".wst/constitution.md"), "utf-8")).rejects.toThrow();
    expect(stdout()).toMatch(/--dry-run: nothing written/);
  });

  it("prints the questions rather than guessing when no answers were given", async () => {
    // The risk answer is the human's. Defaulting it would make the whole
    // interview decorative.
    const dir = await bare();
    expect(await runInit({}, dir)).toBe(0);
    await expect(readFile(join(dir, ".wst/constitution.md"), "utf-8")).rejects.toThrow();
  });

  it("rejects a --strict entry that cannot say why it exists", async () => {
    // Same rule the triage schema enforces: a rule with no reason cannot be
    // reviewed, and therefore cannot ever be retired.
    const dir = await bare();
    expect(await runInit({ purpose: PURPOSE, strict: ["src/core/**"] }, dir)).toBe(1);
    expect(stderr()).toMatch(/has no reason/);
  });
});
