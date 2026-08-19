/**
 * HARD RULE 9, from the outside: the judge is hermetic.
 *
 * `shell/claude.ts` strips the target repo's MCP servers, hooks, setting sources and
 * tools so a repo cannot hijack its own reviewer. Its header says so at length.
 * Until this test nothing checked it.
 *
 * That gap mattered more than most, because a charged judge fails SILENTLY: it still
 * returns verdicts — worse ones, shaped by whatever the repo under review told it.
 * The measured cost of the leak was 140,682 input tokens / $0.84 for a one-word
 * answer against ~11.4k hermetic, plus sig-0033, where a user-level SessionStart hook
 * injected another project's prompts into a verdict.
 *
 * WHAT THIS FILE USED TO ALSO COVER, and no longer can. Rule 9 was a PAIR — judge
 * hermetic, crewmate charged — and this file asserted both halves against one shared
 * `ISOLATION_FLAGS` list, so neither could drift into its own idea of isolation.
 * ADR-0014 deleted `shell/crewmate.ts`, and the three describes that exercised it
 * went with it: that the crewmate carries NONE of the isolation flags, that it runs
 * in its worktree while the judge runs in `tmpdir()`, and how it reports a `claude`
 * that died mid-run. That behaviour is gone from the codebase rather than gone
 * untested — a crewmate is now a session a human opens — but the asymmetry test is
 * gone too, so nothing here fails if the judge ever loses a flag to a refactor aimed
 * at something else. The PRESENT-on-the-judge half below is what still guards it.
 *
 * Everything here runs against a fake `claude` on PATH (`test/fake-bin.ts`), which
 * records the argv, cwd and stdin it was handed. No tokens are spent.
 */

import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LensVerdictSchema } from "../src/core/gate/outcomes.js";
import { createClaudeJudge } from "../src/shell/claude.js";
import { emptyPath, installFakeBin, restorePath, type Invocation } from "./fake-bin.js";

afterEach(() => restorePath());

/**
 * The flags that make a call hermetic. Named once, then asserted PRESENT on the
 * judge. The ABSENT-on-the-crewmate half left with ADR-0014; the list stays named
 * once so a refactor cannot quietly shorten it.
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
    // and the hermetic-versus-charged numbers in docs/architecture.md are the
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

