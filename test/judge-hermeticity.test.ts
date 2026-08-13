/**
 * HARD RULE 9, from the outside: judge = hermetic, crewmate = charged.
 *
 * `shell/claude.ts` strips the target repo's MCP servers, hooks, setting sources and
 * tools so a repo cannot hijack its own reviewer. `shell/crewmate.ts` loads them
 * deliberately, because `.wst/` and `AGENTS.md` ARE the crewmate's charter. Both
 * files say so in their headers, at length. Until this test nothing checked it.
 *
 * That gap mattered more than most, because inverting the pair fails SILENTLY in
 * both directions. A charged judge still returns verdicts — worse ones, shaped by
 * whatever the repo under review told it — and the measured cost of the leak was
 * 140,682 input tokens / $0.84 for a one-word answer against ~11.4k hermetic, plus
 * sig-0033, where a user-level SessionStart hook injected another project's prompts
 * into a verdict. A hermetic crewmate still works; it just ignores the project's
 * rules. Neither shows up as a failure anywhere.
 *
 * Everything here runs against a fake `claude` on PATH (`test/fake-bin.ts`), which
 * records the argv, cwd and stdin it was handed. No tokens are spent.
 */

import { realpathSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LensVerdictSchema } from "../src/core/gate/outcomes.js";
import { createClaudeJudge } from "../src/shell/claude.js";
import { createCrewmateAdapter } from "../src/shell/crewmate.js";
import { emptyPath, installFakeBin, restorePath, type Invocation } from "./fake-bin.js";

afterEach(() => restorePath());

/**
 * The flags that make a call hermetic. Named once, then asserted PRESENT on the
 * judge and ABSENT on the crewmate — one list, so the two halves of rule 9 cannot
 * drift apart into two different ideas of what isolation means.
 */
const ISOLATION_FLAGS = [
  "--strict-mcp-config",
  "--mcp-config",
  "--setting-sources",
  "--settings",
  "--tools",
] as const;

const valueOf = (argv: readonly string[], flag: string): string | undefined =>
  argv[argv.indexOf(flag) + 1];

const VERDICT_ENVELOPE = JSON.stringify({
  is_error: false,
  structured_output: { verdict: "pass", reason: "nothing to report" },
  total_cost_usd: 0.031,
  usage: {
    input_tokens: 11_000,
    cache_creation_input_tokens: 300,
    cache_read_input_tokens: 100,
    output_tokens: 42,
  },
  duration_ms: 4321,
  session_id: "sess-1",
});

const CREWMATE_ENVELOPE = JSON.stringify({
  is_error: false,
  result: "done",
  total_cost_usd: 1.5,
  duration_ms: 9000,
  session_id: "sess-2",
});

async function judgeOnce(prompt = "Review this diff.\n\n@@ -1 +1 @@"): Promise<Invocation> {
  const fake = await installFakeBin("claude", { stdout: VERDICT_ENVELOPE });
  await createClaudeJudge().judge({
    lens: "You are a correctness reviewer.",
    prompt,
    schema: LensVerdictSchema,
    model: "sonnet",
    maxBudgetUsd: 0.5,
    timeoutMs: 30_000,
  });
  const [only] = await fake.invocations();
  expect(only).toBeDefined();
  return only as Invocation;
}

/**
 * A directory that is NOT the temp root the judge stands in. The distinction is
 * load-bearing: with the worktree set to `tmpdir()` itself, an adapter that had
 * been rewritten to stand in the temp root would satisfy `cwd === worktreePath`
 * by coincidence, and the crewmate half of rule 9 would assert nothing.
 */
async function worktreeDir(): Promise<string> {
  return realpathSync(await mkdtemp(join(tmpdir(), "wst-worktree-")));
}

async function dispatchOnce(worktreePath: string): Promise<Invocation> {
  const fake = await installFakeBin("claude", { stdout: CREWMATE_ENVELOPE });
  await createCrewmateAdapter().dispatch({
    charter: "Do the work described in .wst/",
    worktreePath,
    model: "opus",
  });
  const [only] = await fake.invocations();
  expect(only).toBeDefined();
  return only as Invocation;
}

describe("the judge is hermetic", () => {
  it("strips the caller's MCP servers, setting sources, hooks and tools", async () => {
    // Each value is asserted, not just the flag's presence. `--mcp-config` pointing
    // at the caller's real config would satisfy a presence check while loading
    // exactly what the flag exists to exclude.
    const { argv } = await judgeOnce();
    expect(argv).toContain("--strict-mcp-config");
    expect(valueOf(argv, "--mcp-config")).toBe('{"mcpServers":{}}');
    expect(valueOf(argv, "--setting-sources")).toBe("");
    expect(JSON.parse(valueOf(argv, "--settings") ?? "null")).toMatchObject({ hooks: {} });
    expect(valueOf(argv, "--tools")).toBe("");
  });

  it("stands in a neutral directory, never in the repo under review", async () => {
    // Auto-memory is indexed BY DIRECTORY and no flag turns it off, so the cwd IS
    // the isolation here. Measured: standing in the target repo pulled a line from
    // that repo's memory index into a verdict about it.
    const { cwd } = await judgeOnce();
    expect(realpathSync(cwd)).toBe(realpathSync(tmpdir()));
    expect(resolve(cwd)).not.toBe(resolve(process.cwd()));
  });

  it("appends to the system prompt instead of replacing it", async () => {
    // `--system-prompt` is what made the model leak tool-call markup into
    // schema-valid fields (sig-0005). The two flag names differ by a prefix, so an
    // exact-membership assertion is the only one that can tell them apart.
    const { argv } = await judgeOnce();
    expect(argv).toContain("--append-system-prompt");
    expect(argv).not.toContain("--system-prompt");
  });

  it("does not use --bare, which would abandon OAuth and bill separately", async () => {
    expect((await judgeOnce()).argv).not.toContain("--bare");
  });

  it("puts the prompt on stdin, where a diff too large for argv still fits", async () => {
    const prompt = `Review this diff.\n\n${"+".repeat(4096)}`;
    const invocation = await judgeOnce(prompt);
    expect(invocation.stdin).toBe(prompt);
    expect(invocation.argv.join(" ")).not.toContain(prompt);
  });
});

describe("the crewmate is charged", () => {
  it("works inside the worktree, because that is where its charter lives", async () => {
    const worktree = await worktreeDir();
    expect((await dispatchOnce(worktree)).cwd).toBe(worktree);
  });

  it("loads none of the judge's isolation flags", async () => {
    const { argv } = await dispatchOnce(await worktreeDir());
    expect(ISOLATION_FLAGS.filter((flag) => argv.includes(flag))).toEqual([]);
  });

  it("defaults to the permission mode that lets it run its own tests", async () => {
    // `auto`, not `acceptEdits`: the latter auto-approves file edits only, and a
    // crewmate that cannot run its own tests cannot check its own work.
    const { argv } = await dispatchOnce(await worktreeDir());
    expect(valueOf(argv, "--permission-mode")).toBe("auto");
  });

  it("always carries a spend ceiling, even when the caller names none", async () => {
    // A runaway crewmate is a billing incident, not a bug report.
    const { argv } = await dispatchOnce(await worktreeDir());
    expect(Number(valueOf(argv, "--max-budget-usd"))).toBeGreaterThan(0);
  });
});

describe("the asymmetry between them", () => {
  it("is exactly backwards from one adapter to the other", async () => {
    // The single assertion this whole file exists for. Swapping the two `cwd`s, or
    // copying the flag block from one file into the other, fails here and nowhere
    // else in the suite.
    const worktree = await worktreeDir();
    const judge = await judgeOnce();
    const crewmate = await dispatchOnce(worktree);

    expect(ISOLATION_FLAGS.every((flag) => judge.argv.includes(flag))).toBe(true);
    expect(ISOLATION_FLAGS.some((flag) => crewmate.argv.includes(flag))).toBe(false);
    expect(crewmate.cwd).toBe(worktree);
    expect(realpathSync(judge.cwd)).not.toBe(crewmate.cwd);
  });
});

describe("a claude that exits non-zero but still wrote an envelope", () => {
  /** Measured: exit 1, stdout `{is_error:true, subtype:"error_max_budget_usd"}`. */
  const BUDGET_STOP = JSON.stringify({
    is_error: true,
    subtype: "error_max_budget_usd",
    total_cost_usd: 0.607,
    duration_ms: 51_000,
  });

  it("is read as a budget stop, not as a failure to spawn", async () => {
    // Discarding stdout on a non-zero exit made every budget stop surface as
    // "could not run the check". That is the exact distinction the gate works to
    // preserve — a check that ran out of budget did not run, but it did not fail
    // to START either, and only one of those names the fix.
    await installFakeBin("claude", { stdout: BUDGET_STOP, exit: 1 });
    const result = await createClaudeJudge().judge({
      lens: "lens",
      prompt: "p",
      schema: LensVerdictSchema,
      timeoutMs: 30_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("budget");
    expect(result.costUsd).toBe(0.607);
  });

  it("is still a spawn failure when there is no envelope to classify from", async () => {
    // The other half of the same branch. Trusting a partial stdout would turn a
    // crashed binary into a confident verdict about nothing.
    await installFakeBin("claude", { stdout: "Segmentation fault", exit: 139 });
    const result = await createClaudeJudge().judge({
      lens: "lens",
      prompt: "p",
      schema: LensVerdictSchema,
      timeoutMs: 30_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("spawn");
  });
});

describe("what the judge meters", () => {
  it("counts cached input alongside fresh input", async () => {
    // The frugality thesis is measured in input tokens. Counting only
    // `input_tokens` would under-report a cached call by the entire cache read,
    // and the hermetic-versus-charged numbers in .wst/architecture.md are the
    // comparison that would quietly stop being true.
    await installFakeBin("claude", { stdout: VERDICT_ENVELOPE });
    const result = await createClaudeJudge().judge({
      lens: "lens",
      prompt: "p",
      schema: LensVerdictSchema,
      timeoutMs: 30_000,
    });
    expect(result.inputTokens).toBe(11_400);
    expect(result.outputTokens).toBe(42);
  });

  it("reports a version it could not read as null rather than guessing one", async () => {
    // `wst status` prints this. "unknown" is a fact; a fabricated version is not.
    emptyPath();
    expect(await createClaudeJudge().describe()).toEqual({ name: "claude", version: null });
  });

  it("reads the version out of whatever else the binary prints", async () => {
    await installFakeBin("claude", { stdout: "2.1.226 (Claude Code)\n" });
    expect(await createClaudeJudge().describe()).toEqual({ name: "claude", version: "2.1.226" });
  });
});

describe("what the crewmate reports back", () => {
  it("calls an is_error envelope a failure, and names the subtype", async () => {
    // `wst run` keeps the worktree for inspection on `ok: false`. Reading an error
    // envelope as success would discard the diff that is the only evidence of what
    // the crewmate did before it died.
    await installFakeBin("claude", {
      stdout: JSON.stringify({
        is_error: true,
        subtype: "error_max_budget_usd",
        result: "",
        total_cost_usd: 5,
      }),
    });
    const result = await createCrewmateAdapter().dispatch({
      charter: "c",
      worktreePath: tmpdir(),
      timeoutMs: 30_000,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("error_max_budget_usd");
    expect(result.costUsd).toBe(5);
  });

  it("returns a failed result rather than throwing when claude is not installed", async () => {
    // The dispatcher's caller keeps a worktree on a failed result. A throw would
    // take the same path only by accident, through a catch written for something
    // else, and `wst run` would report a crash instead of a crewmate that never ran.
    emptyPath();
    const result = await createCrewmateAdapter().dispatch({
      charter: "c",
      worktreePath: tmpdir(),
      timeoutMs: 30_000,
    });

    expect(result.ok).toBe(false);
    expect(result.error ?? "").not.toBe("");
    expect(result.costUsd).toBe(0);
  });

  it("does not read unparseable output as a finished run", async () => {
    await installFakeBin("claude", { stdout: "not json at all" });
    const result = await createCrewmateAdapter().dispatch({
      charter: "c",
      worktreePath: tmpdir(),
      timeoutMs: 30_000,
    });
    expect(result.ok).toBe(false);
  });
});
