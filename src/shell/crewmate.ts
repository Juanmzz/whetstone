/**
 * Crewmate adapter — spawns a working agent inside a worktree.
 *
 * THE OPPOSITE OF `shell/claude.ts`, deliberately.
 *
 * `claude.ts` runs a JUDGE and makes the call HERMETIC: it strips the target repo's
 * MCP servers, hooks, output style and `AGENTS.md` so a repo cannot hijack its own
 * reviewer (`NeutralizesGateInstructions`).
 *
 * A crewmate is the inverse. `.sdd/` and `AGENTS.md` ARE its charter, its hooks are
 * the guardrails we want firing, and it needs real tools to do the work. So it runs
 * CHARGED — the repo's own configuration loaded on purpose.
 *
 * Getting these two backwards would be a serious bug in both directions: a hermetic
 * crewmate ignores the project's rules, and a charged judge can be told by the repo
 * under review what to think of it.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * `auto`: uninterrupted execution with a model classifier reviewing commands to
 * prevent scope escalation. Grounded against code.claude.com/docs/en/permission-modes.
 * NOT `acceptEdits`, which auto-approves file edits only — a crewmate that cannot run
 * its own tests cannot check its own work.
 */
export type CrewmateMode = "auto" | "acceptEdits" | "bypassPermissions";

export interface CrewmateRequest {
  readonly charter: string;
  readonly worktreePath: string;
  readonly model?: string;
  /** Hard ceiling. A runaway crewmate is a billing incident, not a bug report. */
  readonly maxBudgetUsd?: number;
  readonly timeoutMs?: number;
  readonly mode?: CrewmateMode;
}

export interface CrewmateResult {
  readonly ok: boolean;
  readonly text: string;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly sessionId: string | null;
  readonly error?: string;
}

export interface CrewmatePort {
  dispatch(req: CrewmateRequest): Promise<CrewmateResult>;
}

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_BUDGET_USD = 5;

export function createCrewmateAdapter(): CrewmatePort {
  return {
    async dispatch(req) {
      const started = Date.now();
      const args = [
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        req.mode ?? "auto",
        "--max-budget-usd",
        String(req.maxBudgetUsd ?? DEFAULT_BUDGET_USD),
      ];
      if (req.model !== undefined) args.push("--model", req.model);

      try {
        const child = run("claude", args, {
          cwd: req.worktreePath, // charged: the repo's own config loads from here
          timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: 64 * 1024 * 1024,
          killSignal: "SIGKILL",
        });
        child.child.stdin?.end(req.charter);
        const { stdout } = await child;

        const env = JSON.parse(stdout) as Record<string, unknown>;
        const num = (v: unknown): number => (typeof v === "number" ? v : 0);
        return {
          ok: env["is_error"] !== true,
          text: typeof env["result"] === "string" ? env["result"] : "",
          costUsd: num(env["total_cost_usd"]),
          durationMs: num(env["duration_ms"]) || Date.now() - started,
          sessionId: typeof env["session_id"] === "string" ? env["session_id"] : null,
          ...(env["is_error"] === true ? { error: String(env["subtype"] ?? "error") } : {}),
        };
      } catch (cause) {
        return {
          ok: false,
          text: "",
          costUsd: 0,
          durationMs: Date.now() - started,
          sessionId: null,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
  };
}
