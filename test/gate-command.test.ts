/**
 * `wst gate` end to end, against a real repository on a real filesystem.
 *
 * `src/commands/` is light tier and its header calls itself a composition root
 * with no decisions in it. Most of that is true, and the parts that are NOT true
 * are what this file covers — the branching that a pure test of `core/gate/`
 * cannot reach because it is about ORDER and about which of two independent
 * bookkeeping channels failed:
 *
 *  - the event log is created BEFORE the registry loads, so a configuration
 *    failure can still be recorded. Move one line and that evidence disappears
 *    with nothing failing.
 *  - `signalError` and `eventError` are reported separately and neither may ever
 *    change the verdict. Hard rule 3 says a broken gate and a failed check must
 *    never share a message; these two warnings are the same rule applied to the
 *    bookkeeping, and merging them is a one-line edit.
 *  - `--no-emit` must silence BOTH logs. Hard rule 10 tells an agent breaking
 *    something on purpose to use it, and a `--no-emit` that still wrote events
 *    would contaminate the evidence log in exactly the runs it exists to protect.
 *
 * Every run here is `--no-lens`: free, offline, and what the pre-push hook runs.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEventLog } from "../src/core/events/parse.js";
import type { EventRecord } from "../src/core/events/record.js";
import { parseSignalLog, type SignalRecord } from "../src/core/signals/parse.js";
import { createCheckRunner, runGate } from "../src/commands/gate.js";
import type { LoadedCheck } from "../src/core/checks/registry.js";
import type { Routing } from "../src/core/contracts.js";
import type { LlmJudge } from "../src/core/ports.js";
import { isolateFromInheritedGit } from "./git-env.js";
import { tempDir } from "./tmp.js";

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

afterEach(() => void vi.restoreAllMocks());

const stdout = (): string => out.join("\n");
const stderr = (): string => err.join("\n");

// ── the fixture repository ───────────────────────────────────────────────────

const TRIAGE = `version: 1
rules:
  - glob: "src/**"
    tier: light
    reason: The sample application in this fixture repository.
`;

/** Frontmatter only differs by the fields under test; the body is not read here. */
function deterministicCheck(id: string, command: string, severity = "block"): string {
  return `---
id: ${id}
description: A deterministic check named ${id}.
kind: deterministic
severity: ${severity}
tiers: [light, strict]
include: ["src/**"]
command: '${command}'
version: 1
---

Fixture check.
`;
}

/**
 * `severity: warn`, and it has to be: the registry physically refuses to load an
 * agent-lens at `block` without a calibration receipt (non-negotiable 2), so
 * there is no way to write this fixture wrong.
 */
const LENS_CHECK = `---
id: lens
description: An agent-lens check.
kind: agent-lens
severity: warn
tiers: [light, strict]
include: ["src/**"]
review_lens: Review this diff for correctness.
version: 1
---

Fixture lens.
`;

interface RepoOptions {
  /** Files under `.wst/checks/`, by filename. */
  readonly checks?: Readonly<Record<string, string>>;
  readonly triage?: string;
}

/**
 * A repository with one committed source file and a `.wst/` — then a working-tree
 * edit, so `git diff HEAD` is non-empty and the default range has something to
 * gate.
 */
async function repo(options: RepoOptions = {}): Promise<string> {
  const dir = await tempDir("wst-gate-", true);
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "config", "user.email", "fixture@example.com");
  await git(dir, "config", "user.name", "fixture");

  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src/app.ts"), "export const answer = 1;\n", "utf-8");

  await mkdir(join(dir, ".wst/checks"), { recursive: true });
  await writeFile(join(dir, ".wst/triage.yaml"), options.triage ?? TRIAGE, "utf-8");
  for (const [name, body] of Object.entries(options.checks ?? { "green.md": deterministicCheck("green", "exit 0") })) {
    await writeFile(join(dir, ".wst/checks", name), body, "utf-8");
  }

  await git(dir, "add", "-A");
  await git(dir, "commit", "-qm", "seed");

  await writeFile(join(dir, "src/app.ts"), "export const answer = 42;\n", "utf-8");
  return dir;
}

const read = async (dir: string, rel: string): Promise<string | null> => {
  try {
    return await readFile(join(dir, rel), "utf-8");
  } catch {
    return null;
  }
};

const events = async (dir: string): Promise<EventRecord[]> => {
  const text = await read(dir, ".wst/events.jsonl");
  return text === null ? [] : parseEventLog(text);
};

const signals = async (dir: string): Promise<SignalRecord[]> => {
  const text = await read(dir, ".wst/memory/signals.jsonl");
  return text === null ? [] : parseSignalLog(text);
};

// ── the two bookkeeping channels ─────────────────────────────────────────────

describe("--no-emit", () => {
  it("writes neither log, so a negative control leaves no trace in either", async () => {
    // Hard rule 10 exists because a deliberate defect has twice contaminated
    // something else, once the evidence log itself. `--no-emit` is the flag that
    // is supposed to make that impossible; a version that only covered signals
    // would still write a run into `events.jsonl`.
    const dir = await repo({ checks: { "red.md": deterministicCheck("red", "exit 1") } });
    await runGate({ range: "HEAD", noLens: true, noEmit: true }, dir);

    expect(await read(dir, ".wst/memory/signals.jsonl")).toBeNull();
    expect(await read(dir, ".wst/events.jsonl")).toBeNull();
    expect(stdout()).not.toMatch(/events:/);
  });

  it("changes nothing about the verdict it suppresses the record of", async () => {
    const dir = await repo({ checks: { "red.md": deterministicCheck("red", "exit 1") } });
    const quiet = await runGate({ range: "HEAD", noLens: true, noEmit: true }, dir);
    const loud = await runGate({ range: "HEAD", noLens: true }, dir);
    expect(quiet).toBe(loud);
  });

  it("is the only thing that stops a blocked run from being recorded", async () => {
    // The control for the two tests above: without the flag, both logs appear.
    const dir = await repo({ checks: { "red.md": deterministicCheck("red", "exit 1") } });
    await runGate({ range: "HEAD", noLens: true }, dir);

    expect((await signals(dir)).map((s) => s.type)).toEqual(["gate-blocked"]);
    expect((await events(dir)).map((e) => e.kind)).toContain("run-finished");
  });
});

describe("a signal log that cannot be read", () => {
  /** One corrupt line, which is what `parseSignalLog` fails closed on. */
  async function withCorruptSignals(): Promise<string> {
    const dir = await repo({ checks: { "red.md": deterministicCheck("red", "exit 1") } });
    await mkdir(join(dir, ".wst/memory"), { recursive: true });
    await writeFile(join(dir, ".wst/memory/signals.jsonl"), "{ not json\n", "utf-8");
    return dir;
  }

  it("does not change the verdict — the gate's answer is the product", async () => {
    const clean = await repo({ checks: { "red.md": deterministicCheck("red", "exit 1") } });
    expect(await runGate({ range: "HEAD", noLens: true }, await withCorruptSignals())).toBe(
      await runGate({ range: "HEAD", noLens: true }, clean),
    );
  });

  it("says so out loud, because a run with no trace is the run that mattered", async () => {
    await runGate({ range: "HEAD", noLens: true }, await withCorruptSignals());
    expect(stderr()).toMatch(/no signals were recorded for this run/);
    expect(stderr()).toMatch(/verdict above still stands/);
  });

  it("still writes the event log, which failed at nothing", async () => {
    // The two channels are independent. Letting one failure suppress the other
    // would lose the only record of the run that lost its signal.
    const dir = await withCorruptSignals();
    await runGate({ range: "HEAD", noLens: true }, dir);
    expect((await events(dir)).map((e) => e.kind)).toContain("run-finished");
  });

  it("reports itself in its own JSON field, never in the event log's", async () => {
    // Hard rule 3 applied to the bookkeeping: two different failures, two
    // different names. Anything reading this as an API has to be able to tell
    // "the evidence was lost" from "the trace was lost".
    const dir = await withCorruptSignals();
    await runGate({ range: "HEAD", noLens: true, json: true }, dir);
    const report = JSON.parse(stdout().slice(stdout().indexOf("{"))) as Record<string, unknown>;

    expect(report["signalError"]).toEqual(expect.any(String));
    expect(report["eventError"]).toBeNull();
    expect(report["emitted"]).toEqual([]);
    expect(report["verdict"]).toBe("block"); // the verdict survived intact
  });
});

describe("an event log that cannot be written", () => {
  /** `.wst/events.jsonl` as a DIRECTORY — the same EISDIR a broken mount gives. */
  async function withBlockedEvents(): Promise<string> {
    const dir = await repo({ checks: { "red.md": deterministicCheck("red", "exit 1") } });
    await mkdir(join(dir, ".wst/events.jsonl"), { recursive: true });
    return dir;
  }

  it("is reported with its own words, not the signal warning's", async () => {
    // The mirror of the test above, and the pair is the point: a reader must
    // never see "no signals were recorded" when the signals were recorded fine.
    const dir = await withBlockedEvents();
    await runGate({ range: "HEAD", noLens: true }, dir);

    expect(stderr()).toMatch(/event log for this run is incomplete/);
    expect(stderr()).not.toMatch(/no signals were recorded/);
  });

  it("does not stop the signal from being written, or the verdict from standing", async () => {
    const dir = await withBlockedEvents();
    expect(await runGate({ range: "HEAD", noLens: true }, dir)).toBe(1);
    expect((await signals(dir)).map((s) => s.type)).toEqual(["gate-blocked"]);
  });
});

// ── configuration that will not load ─────────────────────────────────────────

describe("a registry the gate cannot read", () => {
  async function withBrokenRegistry(): Promise<string> {
    const dir = await repo();
    await writeFile(join(dir, ".wst/checks/green.md"), "no frontmatter here\n", "utf-8");
    return dir;
  }

  it("exits misconfigured rather than passing a change nothing verified", async () => {
    expect(await runGate({ range: "HEAD", noLens: true }, await withBrokenRegistry())).toBe(2);
    expect(stderr()).toMatch(/configuration failed to load/);
  });

  it("records the failure, which is the whole reason the log is opened first", async () => {
    // `definitionRoot` is resolved ahead of everything else so that a failure
    // after that point can be RECORDED. Loading the registry before creating the
    // log would make this evidence vanish, and no other test would notice.
    const dir = await withBrokenRegistry();
    await runGate({ range: "HEAD", noLens: true }, dir);
    const kinds = (await events(dir)).map((e) => e.kind);

    expect(kinds).toContain("run-started");
    expect(kinds).toContain("run-failed");
    expect(kinds).not.toContain("run-finished"); // it did not finish
  });

  it("stamps the exit code on the failure event, so a reader need not infer it", async () => {
    const dir = await withBrokenRegistry();
    await runGate({ range: "HEAD", noLens: true }, dir);
    expect((await events(dir)).find((e) => e.kind === "run-failed")?.exit).toBe(2);
  });
});

describe("a repository still holding the pre-ADR-0012 directory", () => {
  it("refuses before the event log exists, and says which directory it found", async () => {
    // The one failure that CANNOT be recorded: the log lives under the directory
    // that could not be resolved. Reported on stderr only, and it must still be
    // an exit code, not a stack trace.
    const dir = await tempDir("wst-gate-legacy-", true);
    await git(dir, "init", "-q", "-b", "main");
    await mkdir(join(dir, ".sdd"), { recursive: true });

    expect(await runGate({ range: "HEAD", noLens: true }, dir)).toBe(2);
    expect(stderr()).toMatch(/configuration failed to load/);
    expect(stderr()).toMatch(/\.sdd/);
    expect(await read(dir, ".wst/events.jsonl")).toBeNull();
  });
});

describe("outside a repository", () => {
  it("says the gate needs one instead of reporting an empty diff as clean", async () => {
    const dir = await tempDir("wst-gate-norepo-");
    expect(await runGate({ range: "HEAD", noLens: true }, dir)).toBe(2);
    expect(stderr()).toMatch(/not inside a git repository/);
  });
});

// ── hard rule 3, end to end ──────────────────────────────────────────────────

describe("a check that could not run", () => {
  it("is errored, never a failure, and the exit code says incomplete", async () => {
    // Rule 3, through every layer at once: `runShellCommand` observes `killed`,
    // `interpretCommandResult` calls it errored, `aggregate` keeps it out of
    // `blocking`, and `exitCodeFor` turns a lost BLOCKING check into 2. A gate
    // that reported 1 here would be blaming the change for its own timeout.
    //
    // NOT asserted here, and reported instead: `renderGateRun` still prints a bare
    // `passed` line above the "NOT fully verified" paragraph, because its only
    // question is whether `blocking` is empty. The exit code and the paragraph are
    // both honest, so nothing is silently green — but the word is there, and rule 3
    // says "no checks ran" must never share a message with "all checks passed".
    // That line lives in `src/core/gate/report.ts`, which this PR may not touch.
    const dir = await repo({ checks: { "slow.md": deterministicCheck("slow", "sleep 30") } });
    expect(await runGate({ range: "HEAD", noLens: true, timeoutMs: 300 }, dir)).toBe(2);

    expect(stdout()).toMatch(/errored\s+slow/);
    expect(stdout()).toMatch(/NOT fully verified/);
    expect(stdout()).not.toMatch(/FAIL\s+slow/); // errored is not a failure of the change
  });

  it("emits check-could-not-run at high severity, not gate-blocked", async () => {
    // The signal a broken gate leaves behind has to be distinguishable from the
    // one a caught defect leaves, or the retro clusters the two together and
    // proposes a rule about the wrong thing.
    const dir = await repo({ checks: { "slow.md": deterministicCheck("slow", "sleep 30") } });
    await runGate({ range: "HEAD", noLens: true, timeoutMs: 300 }, dir);

    const emitted = await signals(dir);
    expect(emitted.map((s) => s.type)).toEqual(["check-could-not-run"]);
    expect(emitted[0]?.severity).toBe("high");
  });
});

describe("--no-lens", () => {
  it("reports the lens as skipped and never as passed", async () => {
    // The flag the pre-push hook uses. "Not reviewed" reported as "reviewed" is
    // the exact collapse the gate exists to prevent, and it would be invisible.
    const dir = await repo({ checks: { "lens.md": LENS_CHECK } });
    await runGate({ range: "HEAD", noLens: true }, dir);

    expect(stdout()).toMatch(/skipped\s+lens\s+— disabled/);
    expect(stdout()).not.toMatch(/pass\s+lens/);
  });

  it("leaves a change with only a lens unverified, not green", async () => {
    // Exit 0 here would tell the hook a change nobody looked at is fine.
    const dir = await repo({ checks: { "lens.md": LENS_CHECK } });
    expect(await runGate({ range: "HEAD", noLens: true }, dir)).toBe(2);
  });
});

describe("a check switched off in its own file", () => {
  it("is incomplete, not uncovered — someone declined coverage that exists", async () => {
    // `enabled: false` reached NO result: `route()` drops it before selection, so
    // the run had zero results and fell through to `uncovered`, which adr-0021
    // exits 0. Same tree, same failing blocking check, green.
    //
    // `uncovered` is for a change nothing covers, where no edit could make the
    // gate pass. Re-enabling a check is an edit, so this is not that.
    const off = deterministicCheck("always-fails", "exit 1").replace(
      "version: 1",
      "enabled: false\nversion: 1",
    );
    const dir = await repo({ checks: { "always-fails.md": off } });

    expect(await runGate({ range: "HEAD" }, dir)).toBe(2);
    expect(stdout()).not.toMatch(/UNCOVERED/);
  });

  it("archives an uncovered run as uncovered, so `wst events` cannot call it passed", async () => {
    // The console said "UNCOVERED — nothing about this change was verified" while
    // the log recorded `status: "pass"` and `detail: "passed — 0 check(s)"`, so
    // the reader replayed it as a pass. The event log is this project's evidence
    // about itself, which is what makes the mismatch worse than cosmetic.
    const dir = await repo({
      checks: { "elsewhere.md": deterministicCheck("elsewhere", "exit 0").replace(
        'include: ["src/**"]',
        'include: ["docs/**"]',
      ) },
    });

    expect(await runGate({ range: "HEAD" }, dir)).toBe(0);
    const finished = (await events(dir)).find((e) => e.kind === "run-finished");

    expect(finished?.status).toBe("uncovered");
    expect(finished?.detail).not.toContain("passed");
  });

  it("blocks when the same check is left on, which is the control", async () => {
    const dir = await repo({
      checks: { "always-fails.md": deterministicCheck("always-fails", "exit 1") },
    });

    expect(await runGate({ range: "HEAD" }, dir)).toBe(1);
  });
});

// ── receipts, and the gate that must not trust them ──────────────────────────

describe("receipts", () => {
  it("skips a check whose input a receipt already covers", async () => {
    const dir = await repo();
    expect(await runGate({ range: "HEAD", noLens: true }, dir)).toBe(0);
    expect(await read(dir, ".wst/receipts/green.json")).not.toBeNull();

    out.length = 0;
    expect(await runGate({ range: "HEAD", noLens: true }, dir)).toBe(0);
    expect(stdout()).toMatch(/skipped\s+green\s+— receipt/);
  });

  it("honours none of them under --no-receipts, and mints none either", async () => {
    // Measured on the first real `wst run` dispatch: every check came back
    // `skipped (receipt)`, so the supervising gate verified nothing and the
    // worker's own run had vouched for its work. A receipt is plain JSON in the
    // tree the worker had write access to.
    const dir = await repo();
    await runGate({ range: "HEAD", noLens: true }, dir);
    expect(await read(dir, ".wst/receipts/green.json")).not.toBeNull();

    out.length = 0;
    await rm(join(dir, ".wst/receipts"), { recursive: true, force: true });
    expect(await runGate({ range: "HEAD", noLens: true, noReceipts: true }, dir)).toBe(0);

    expect(stdout()).toMatch(/pass\s+green/);
    expect(stdout()).not.toMatch(/skipped\s+green/);
    expect(await read(dir, ".wst/receipts/green.json")).toBeNull();
  });
});

// ── the check runner, where the lens budget is spent ─────────────────────────

describe("createCheckRunner", () => {
  /** A judge that always answers, at a fixed price. The price is what is under test. */
  function judgeCosting(costUsd: number): LlmJudge {
    const judge = async (): Promise<unknown> => ({
      ok: true,
      value: { verdict: "pass", reason: "nothing to report" },
      attempts: [],
      raw: "",
      costUsd,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      sessionId: null,
    });
    return {
      judge: judge as unknown as LlmJudge["judge"],
      describe: async () => ({ name: "stub", version: null }),
    };
  }

  const lensCheck: LoadedCheck = {
    id: "lens",
    description: "An agent-lens check.",
    kind: "agent-lens",
    severity: "warn",
    tiers: ["light"],
    include: ["src/**"],
    exclude: [],
    enabled: true,
    version: 1,
    origin: [],
    review_lens: "Review this diff.",
    body: "",
  };

  const routing: Routing = {
    tier: "light",
    checks: ["lens"],
    autonomy: "autonomous",
    modelTier: "sonnet",
    autofix: true,
  };

  const runner = (dir: string, judge: LlmJudge, maxLensTotalUsd: number, range = "HEAD") =>
    createCheckRunner({
      cwd: dir,
      range,
      judge,
      routing,
      maxLensUsd: 0.5,
      maxLensTotalUsd,
      noLens: false,
      timeoutMs: 30_000,
    });

  /**
   * Four files, each with a diff that busts the 24 KB chunk budget on its own.
   *
   * MULTIPLE FILES, not one big one: `chunkDiff` splits on file boundaries only —
   * half a file is not reviewable — so a single file is always exactly one chunk
   * however large it gets. A one-file fixture would exercise the budget loop once
   * and prove nothing about the ceiling.
   */
  const BIG_FILES = 4;

  async function repoWithHugeDiff(): Promise<string> {
    const dir = await repo();
    const body = (suffix: string): string =>
      `${Array.from({ length: 400 }, (_, i) => `export const value${i} = "${"x".repeat(40)}"; ${suffix}`).join("\n")}\n`;

    for (let f = 0; f < BIG_FILES; f++) {
      await writeFile(join(dir, `src/big${f}.ts`), body("// before"), "utf-8");
    }
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "big");
    for (let f = 0; f < BIG_FILES; f++) {
      await writeFile(join(dir, `src/big${f}.ts`), body("// after"), "utf-8");
    }
    return dir;
  }

  const bigFiles = Array.from({ length: BIG_FILES }, (_, f) => ({
    path: `src/big${f}.ts`,
    status: "modified" as const,
  }));

  it("stops spending at the total ceiling and refuses to call the rest a pass", async () => {
    // sig-0023: the per-chunk cap is what makes the spend bounded, but a total
    // ceiling still has to exist or a 500-file change bills without end. The
    // honesty half is here — chunks nobody judged make the whole check
    // `errored`, because partial coverage is not verification.
    const dir = await repoWithHugeDiff();
    const outcome = await runner(dir, judgeCosting(2), 3)(lensCheck, bigFiles);

    expect(outcome.outcome.status).toBe("errored");
    if (outcome.outcome.status !== "errored") return;
    expect(outcome.outcome.detail).toMatch(/budget/);
  });

  it("passes only when every chunk was judged", async () => {
    // The control: same diff, a ceiling nothing hits.
    const dir = await repoWithHugeDiff();
    const outcome = await runner(dir, judgeCosting(0.01), 100)(lensCheck, bigFiles);
    expect(outcome.outcome.status).toBe("pass");
  });

  it("errors rather than fails when the diff itself cannot be read", async () => {
    // Rule 3 again, at the other boundary. A range that does not resolve is the
    // gate being broken; blaming the change for it would block on nothing.
    const dir = await repo();
    const outcome = await runner(dir, judgeCosting(0.01), 100, "no-such-ref..HEAD")(lensCheck, [
      { path: "src/app.ts", status: "modified" },
    ]);

    expect(outcome.outcome.status).toBe("errored");
    if (outcome.outcome.status !== "errored") return;
    expect(outcome.outcome.detail).toMatch(/could not read the diff/);
  });

  it("skips a lens under --no-lens instead of reporting it unreviewed-but-fine", async () => {
    const dir = await repo();
    const outcome = await createCheckRunner({
      cwd: dir,
      range: "HEAD",
      judge: judgeCosting(0.01),
      routing,
      maxLensUsd: 0.5,
      maxLensTotalUsd: 3,
      noLens: true,
      timeoutMs: 30_000,
    })(lensCheck, [{ path: "src/app.ts", status: "modified" }]);

    expect(outcome.outcome).toEqual({ status: "skipped", reason: "disabled" });
  });
});

// ── what a bad range looks like ──────────────────────────────────────────────

describe("a range git cannot resolve", () => {
  it("names the range it could not read, rather than reporting an empty diff", async () => {
    // This used to be saved by the honesty rule one layer up: the adapter returned
    // "" for a range git rejected, the gate found no files, and "a run that
    // verified nothing is not a pass" turned that into exit 2. Correct number,
    // useless sentence — it said the change had no checks, when the truth was that
    // there was no such change to check.
    //
    // `diffNameStatus` now throws, so the message names the range. The exit code
    // is unchanged, which is the point: this was never about the number.
    const dir = await repo();
    expect(await runGate({ range: "no-such-ref..HEAD", noLens: true }, dir)).toBe(2);
    expect(stderr()).toMatch(/could not read the diff for no-such-ref\.\.HEAD/);
  });
});

// ── a definition directory a command can still work without ──────────────────

describe("a repository with no .wst/ at all", () => {
  it("runs, registers no checks, and does not call that a verified pass", async () => {
    const dir = await tempDir("wst-gate-bare-", true);
    await git(dir, "init", "-q", "-b", "main");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/app.ts"), "export const a = 1;\n", "utf-8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "seed");
    await writeFile(join(dir, "src/app.ts"), "export const a = 2;\n", "utf-8");

    expect(await runGate({ range: "HEAD", noLens: true }, dir)).toBe(2);
    expect(stdout()).toMatch(/nothing about this change was verified/);
  });
});
