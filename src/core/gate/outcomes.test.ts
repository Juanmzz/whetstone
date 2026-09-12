import { describe, expect, it } from "vitest";
import type { JudgeErrorKind } from "../llm/verdict.js";
import type { JudgeResult } from "../ports.js";
import {
  LensVerdictSchema,
  interpretCommandResult,
  interpretJudgeResult,
  type CommandResult,
  type LensVerdict,
} from "./outcomes.js";

const command = (over: Partial<CommandResult> = {}): CommandResult => ({
  exitCode: 0,
  signal: null,
  stdout: "",
  stderr: "",
  ...over,
});

const judged = (over: Partial<JudgeResult<LensVerdict>>): JudgeResult<LensVerdict> =>
  ({
    ok: true,
    value: { verdict: "pass", reason: "no bug introduced" },
    attempts: [],
    raw: "{}",
    costUsd: 0.04,
    inputTokens: 11_000,
    outputTokens: 300,
    durationMs: 1200,
    sessionId: "s1",
    ...over,
  }) as JudgeResult<LensVerdict>;

describe("interpretCommandResult — a deterministic check's exit status", () => {
  it("passes on exit 0", () => {
    expect(interpretCommandResult(command({ exitCode: 0 }))).toEqual({ status: "pass" });
  });

  it("fails on a non-zero exit — this is a REAL failure, the check ran and said no", () => {
    const outcome = interpretCommandResult(
      command({ exitCode: 1, stdout: "2 tests failed", stderr: "" }),
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.status === "fail" && outcome.detail).toContain("2 tests failed");
  });

  it("reports the exit code when the command printed nothing at all", () => {
    const outcome = interpretCommandResult(command({ exitCode: 3 }));
    expect(outcome.status === "fail" && outcome.detail).toMatch(/exit(ed)? (with )?(code )?3/i);
  });

  it("truncates a huge output from the FRONT, keeping the tail where the summary lives", () => {
    const outcome = interpretCommandResult(command({ exitCode: 1, stdout: `${"x".repeat(9000)}THE SUMMARY` }));
    const detail = outcome.status === "fail" ? outcome.detail : "";
    expect(detail).toContain("THE SUMMARY");
    expect(detail.length).toBeLessThan(3000);
    expect(detail.startsWith("…")).toBe(true);
  });

  /**
   * RULE 1 at the process boundary. Every case below is the GATE being broken, not
   * the change being wrong — so none of them may produce `fail`, because `fail` at
   * `block` severity is the only thing that blocks.
   */
  describe("rule 1 — a command that could not run is errored, never failed", () => {
    it("errors when the process could not be spawned", () => {
      const outcome = interpretCommandResult(
        command({ exitCode: null, spawnError: "spawn npm ENOENT" }),
      );
      expect(outcome.status).toBe("errored");
      expect(outcome.status === "errored" && outcome.detail).toContain("ENOENT");
    });

    it("errors on a timeout, even though the process also reported a non-zero exit", () => {
      // execFile on timeout reports BOTH a kill signal and (on some platforms) a
      // code. Reading the code first would turn every slow test run into a block.
      const outcome = interpretCommandResult(
        command({ exitCode: 1, signal: "SIGKILL", timedOut: true }),
      );
      expect(outcome.status).toBe("errored");
      expect(outcome.status === "errored" && outcome.detail).toMatch(/timed out/i);
    });

    it("errors when the process was killed by a signal", () => {
      const outcome = interpretCommandResult(command({ exitCode: null, signal: "SIGTERM" }));
      expect(outcome.status).toBe("errored");
      expect(outcome.status === "errored" && outcome.detail).toContain("SIGTERM");
    });

    it("errors when there is no exit status at all", () => {
      const outcome = interpretCommandResult(command({ exitCode: null }));
      expect(outcome.status).toBe("errored");
    });

    it("does not quote the package manager's echo of its own script", () => {
      // Seen on a real run: the detail ended at `> sift@0.1.0 lint`, because npm
      // echoes its script before failing and that pushed out the missing binary.
      const outcome = interpretCommandResult(
        command({
          exitCode: 127,
          stdout: "> sift@0.1.0 lint\n> eslint .\n",
          stderr: "sh: eslint: command not found",
        }),
      );
      expect(outcome.status).toBe("errored");
      const detail = outcome.status === "errored" ? outcome.detail : "";
      expect(detail).toContain("sh: eslint: command not found");
      expect(detail).not.toContain("sift@0.1.0");
    });

    it("errors on the shell's `command not found` (127) and `not executable` (126)", () => {
      // Found by running the gate on this repo. A deterministic check runs through a
      // shell, so a missing binary does NOT arrive as a spawn error — the shell
      // starts fine and exits 127. Read as an exit code that is a `fail`, and a
      // `block`-severity check with a missing tool would block every change in the
      // repo while reporting it as the change's fault. POSIX reserves both codes.
      for (const exitCode of [126, 127]) {
        const outcome = interpretCommandResult(
          command({ exitCode, stderr: "sh: npm: command not found" }),
        );
        expect(outcome.status, String(exitCode)).toBe("errored");
        expect(outcome.status === "errored" && outcome.detail).toContain("command not found");
      }
    });

    it("errors on a spawn failure even when a zero exit code is also present", () => {
      // Fail closed: a contradictory report is not evidence that the check passed.
      const outcome = interpretCommandResult(command({ exitCode: 0, spawnError: "EACCES" }));
      expect(outcome.status).toBe("errored");
    });
  });
});

describe("interpretJudgeResult — an agent lens's verdict", () => {
  it("passes when the lens returned pass", () => {
    expect(interpretJudgeResult(judged({}))).toEqual({ outcome: { status: "pass" }, costUsd: 0.04 });
  });

  it("fails when the lens returned fail, carrying its reason as the detail", () => {
    const run = interpretJudgeResult(
      judged({ value: { verdict: "fail", reason: "off-by-one at the upper bound" } }),
    );
    expect(run.outcome.status).toBe("fail");
    expect(run.outcome.status === "fail" && run.outcome.detail).toBe(
      "off-by-one at the upper bound",
    );
  });

  /**
   * RULE 1 at the LLM boundary. `core/llm/verdict.ts` already separates "the model
   * said no" from "we never got a usable answer". Every `JudgeError` is the second
   * kind, including `invalid-output` — a model that cannot emit a parseable verdict
   * has not found a bug, it has failed to answer.
   */
  describe("rule 1 — every judge error is errored, never failed", () => {
    const KINDS: readonly JudgeErrorKind[] = [
      "invalid-output",
      "budget",
      "max-turns",
      "timeout",
      "spawn",
      "auth",
      "unknown",
    ];

    it("maps every JudgeErrorKind to errored", () => {
      for (const kind of KINDS) {
        const run = interpretJudgeResult(
          judged({ ok: false, value: undefined, error: { kind, detail: `${kind} happened` } }),
        );
        expect(run.outcome.status, kind).toBe("errored");
        expect(run.outcome.status === "errored" && run.outcome.detail, kind).toContain(kind);
      }
    });

    it("still bills the cost of a failed judgement — retries are not free", () => {
      const run = interpretJudgeResult(
        judged({
          ok: false,
          value: undefined,
          error: { kind: "invalid-output", detail: "no valid verdict after 3 attempts" },
          costUsd: 0.12,
        }),
      );
      expect(run.costUsd).toBeCloseTo(0.12);
      expect(run.outcome.status).toBe("errored");
    });
  });
});

describe("LensVerdictSchema", () => {
  it("accepts a well-formed verdict", () => {
    expect(LensVerdictSchema.safeParse({ verdict: "fail", reason: "why" }).success).toBe(true);
  });

  it("rejects a verdict with no reason — an unexplained block is not reviewable", () => {
    expect(LensVerdictSchema.safeParse({ verdict: "fail" }).success).toBe(false);
    expect(LensVerdictSchema.safeParse({ verdict: "fail", reason: "" }).success).toBe(false);
  });

  it("rejects any verdict word other than pass or fail", () => {
    expect(LensVerdictSchema.safeParse({ verdict: "block", reason: "x" }).success).toBe(false);
  });
});

/**
 * Gap found by `npm run mutate`: flipping `<=` to `<` on the truncation boundary
 * survived, because no test sat exactly on MAX_DETAIL. An off-by-one there
 * silently ellipsises output that fit perfectly.
 */
describe("tail — the truncation boundary", () => {
  const run = (stdout: string) =>
    interpretCommandResult({ exitCode: 1, stdout, stderr: "", signal: null });

  it("does not truncate output that is exactly at the limit", () => {
    const out = run("x".repeat(2000));
    if (out.status === "fail") {
      expect(out.detail.startsWith("…")).toBe(false);
      expect(out.detail).toHaveLength(2000);
    }
  });

  it("truncates output one byte over the limit, keeping the TAIL", () => {
    // The tail, not the head: the error a human needs is at the end of a log.
    const out = run(`HEAD${"x".repeat(2000)}TAIL`);
    if (out.status === "fail") {
      expect(out.detail.startsWith("…")).toBe(true);
      expect(out.detail.endsWith("TAIL")).toBe(true);
      expect(out.detail).not.toContain("HEAD");
    }
  });
});
