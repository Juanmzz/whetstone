/**
 * The gate orchestrator: select -> skip by receipt -> run -> aggregate -> record.
 *
 * PURE, in the sense `core/orchestrate/` means it: every effect arrives as a
 * PARAMETER. Nothing here spawns a process, reads a file or calls a model, so the
 * whole sequencing and receipt policy is unit-testable without a repository, a
 * `claude` binary or a single billed token. That is the point of the tier — without
 * it this logic would land in `src/commands/`, which no test guards.
 *
 * The five invariants live at three different levels, deliberately:
 *   - `aggregate` decides pass/block and is the only place `blocking` is populated.
 *   - `outcomes.ts` decides fail-vs-errored at each boundary.
 *   - this file decides what runs and what gets a receipt.
 * A bug in one is visible in its own tests rather than smeared across the pipeline.
 */

import type { LoadedCheck, Registry } from "../checks/registry.js";
import type { CheckResult, GateVerdict, Routing } from "../contracts.js";
import type { ChangedFile } from "../diff/parse.js";
import type { ClockPort, GitPort } from "../ports.js";
import { inputHash, type HashedFile } from "../receipts/hash.js";
import { recordPass, shouldSkip, type Receipt } from "../receipts/receipt.js";
import { aggregate } from "./aggregate.js";
import type { RunOutcome } from "./outcomes.js";
import { selectChecks, type Selection } from "./select.js";

/**
 * The hash recorded for a file the change DELETED. Git's null object id: forty
 * zeroes, which git never mints as a real object.
 *
 * A deletion is part of the input — a check whose file was removed is looking at
 * different code than before, so the receipt must change. But `git hash-object` on a
 * path that no longer exists fails, and treating that as "unhashable" would mean a
 * change containing any deletion could never earn a receipt. A constant standing for
 * "absent" is both correct and cheap.
 */
export const DELETED_FILE_HASH = "0000000000000000000000000000000000000000";

/**
 * Reading and writing receipts. Declared here rather than in the shared `ports.ts`
 * because it is this orchestrator's contract with its adapter, not a project-wide
 * port — the same reason `judgeWithRetry` declares `SingleShot` locally.
 */
export interface ReceiptStore {
  read(checkId: string): Promise<Receipt | null>;
  write(receipt: Receipt): Promise<void>;
}

/**
 * Runs ONE check against the files it matched.
 *
 * It may reject: the orchestrator converts a thrown error into `errored`, never into
 * `fail`. An adapter that crashes is the gate being broken (rule 1), and making the
 * runner's error channel mean "the check failed" is the most natural way for that
 * rule to get broken in practice.
 */
export type CheckRunner = (
  check: LoadedCheck,
  files: readonly ChangedFile[],
) => Promise<RunOutcome>;

export interface GatePorts {
  /** `GitPort.hashFile` — content hash at the working tree. */
  readonly hashFile: GitPort["hashFile"];
  readonly clock: ClockPort;
  readonly receipts: ReceiptStore;
  readonly run: CheckRunner;
}

export interface GateInput {
  /** From triage. Taken as a parameter: `core/triage/` is a parallel lane. */
  readonly routing: Routing;
  readonly registry: Registry;
  readonly files: readonly ChangedFile[];
}

export interface ReceiptError {
  readonly checkId: string;
  readonly detail: string;
}

export interface GateRun {
  readonly verdict: GateVerdict;
  readonly selection: Selection;
  /** Check ids that earned a receipt this run. */
  readonly receiptsWritten: readonly string[];
  /**
   * Receipts that passed but could not be persisted. Reported, never fatal: a cache
   * write failing must not change a verdict, or the gate's answer would depend on
   * whether the disk was writable.
   */
  readonly receiptErrors: readonly ReceiptError[];
}

const detailOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** What one selected check needs before it can be run or skipped. */
interface Prepared {
  readonly check: LoadedCheck;
  readonly files: readonly ChangedFile[];
  /** `null` when some file could not be hashed — then no receipt is read or written. */
  readonly hashed: readonly HashedFile[] | null;
  readonly hash: string | null;
}

export async function runGate(input: GateInput, ports: GatePorts): Promise<GateRun> {
  const { routing, registry, files } = input;
  const selection = selectChecks(routing, registry, files);

  const results = new Map<string, CheckResult>();

  // Routing named a check that does not exist: a stale routing table, or a check
  // file someone deleted. We do not know its severity, so we assume the worst —
  // `block` — precisely to demonstrate that it STILL does not block. `errored` is
  // never consulted for severity.
  for (const checkId of selection.unknown) {
    results.set(checkId, {
      checkId,
      checkVersion: 0,
      severity: "block",
      outcome: {
        status: "errored",
        detail:
          `routing selected check "${checkId}", which is not in the registry — ` +
          `the gate is misconfigured, so this change was not verified against it`,
      },
      durationMs: 0,
    });
  }

  for (const excluded of selection.excluded) {
    results.set(excluded.checkId, {
      checkId: excluded.checkId,
      checkVersion: excluded.checkVersion,
      severity: excluded.severity,
      outcome: { status: "skipped", reason: excluded.reason },
      durationMs: 0,
    });
  }

  // One hash per path, however many checks matched it. `git hash-object` is a
  // process spawn per call in the real adapter, so this is not a micro-optimisation.
  const hashes = new Map<string, Promise<string>>();
  const hashOf = (file: ChangedFile): Promise<string> => {
    if (file.status === "deleted") return Promise.resolve(DELETED_FILE_HASH);
    const existing = hashes.get(file.path);
    if (existing !== undefined) return existing;
    const pending = ports.hashFile(file.path);
    hashes.set(file.path, pending);
    return pending;
  };

  const prepared: Prepared[] = [];
  for (const selected of selection.selected) {
    let hashed: HashedFile[] | null = null;
    try {
      hashed = await Promise.all(
        selected.files.map(async (file) => ({ path: file.path, hash: await hashOf(file) })),
      );
    } catch {
      // We cannot describe this check's input, so we cannot trust a receipt for it
      // and must not mint one. The check itself still runs — resolving toward MORE
      // verification, never less.
      hashed = null;
    }

    prepared.push({
      check: selected.check,
      files: selected.files,
      hashed,
      hash: hashed === null ? null : inputHash(hashed, selected.check.version),
    });
  }

  // ── the receipt skip ──────────────────────────────────────────────────────
  const toRun: Prepared[] = [];
  for (const item of prepared) {
    if (item.hash === null) {
      toRun.push(item);
      continue;
    }

    let receipt: Receipt | null = null;
    try {
      receipt = await ports.receipts.read(item.check.id);
    } catch {
      // A cache we cannot read is a cache MISS. Every ambiguity resolves toward
      // re-running: a wrongly skipped check is an unnoticed hole in the gate.
      receipt = null;
    }

    if (shouldSkip(receipt, item.hash).skip) {
      results.set(item.check.id, {
        checkId: item.check.id,
        checkVersion: item.check.version,
        severity: item.check.severity,
        outcome: { status: "skipped", reason: "receipt" },
        durationMs: 0,
      });
      continue;
    }

    toRun.push(item);
  }

  // ── running ───────────────────────────────────────────────────────────────
  //
  // Deterministic checks are free and independent, so they go together.
  // Agent-lens checks are billed per call, so they go one at a time: it keeps the
  // spend observable and bounded rather than fanning out N concurrent models.
  //
  // There is deliberately NO short-circuit when a blocking check has already
  // failed. Skipping the remaining checks would be cheaper, but `CheckOutcome` has
  // no honest reason code for "we stopped early", and rule 4 requires every skip to
  // be reported with its reason. Reusing one of the existing reasons would be a lie
  // in the audit trail. Adding one is a change to the shared contract, i.e. a
  // conversation. Meanwhile the full report is also the more useful one.
  const runOne = async (item: Prepared): Promise<CheckResult> => {
    const started = ports.clock.now().getTime();
    let outcome: RunOutcome;
    try {
      outcome = await ports.run(item.check, item.files);
    } catch (cause) {
      outcome = {
        outcome: {
          status: "errored",
          detail: `the check could not be run: ${detailOf(cause)}`,
        },
      };
    }
    const durationMs = Math.max(0, ports.clock.now().getTime() - started);

    return {
      checkId: item.check.id,
      checkVersion: item.check.version,
      severity: item.check.severity,
      outcome: outcome.outcome,
      durationMs,
      ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
    };
  };

  const deterministic = toRun.filter((item) => item.check.kind === "deterministic");
  const lenses = toRun.filter((item) => item.check.kind === "agent-lens");

  for (const result of await Promise.all(deterministic.map(runOne))) {
    results.set(result.checkId, result);
  }
  for (const item of lenses) {
    const result = await runOne(item);
    results.set(result.checkId, result);
  }

  // ── receipts, on pass only ────────────────────────────────────────────────
  //
  // `recordPass` is the only constructor and its `outcome` is the literal "pass",
  // so a receipt for a failed check does not typecheck. This loop only has to get
  // the guard right; the type stops the rest.
  const receiptsWritten: string[] = [];
  const receiptErrors: ReceiptError[] = [];
  for (const item of toRun) {
    if (item.hashed === null) continue; // no describable input, no receipt
    if (results.get(item.check.id)?.outcome.status !== "pass") continue;

    try {
      await ports.receipts.write(
        recordPass({
          checkId: item.check.id,
          checkVersion: item.check.version,
          files: item.hashed,
          at: ports.clock.now(),
        }),
      );
      receiptsWritten.push(item.check.id);
    } catch (cause) {
      receiptErrors.push({ checkId: item.check.id, detail: detailOf(cause) });
    }
  }

  // Emit in ROUTING order, not completion order: two gate runs over the same change
  // must produce byte-identical output, or the report cannot be diffed or trusted.
  const ordered: CheckResult[] = [];
  const emitted = new Set<string>();
  for (const checkId of routing.checks) {
    if (emitted.has(checkId)) continue;
    emitted.add(checkId);
    const result = results.get(checkId);
    if (result !== undefined) ordered.push(result);
  }

  return { verdict: aggregate(ordered), selection, receiptsWritten, receiptErrors };
}
