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

import { NULL_SINK, type EventSink } from "../events/record.js";
import type { LoadedCheck, Registry } from "../checks/registry.js";
import type { CheckResult, GateVerdict, Routing } from "../contracts.js";
import type { ChangedFile } from "../diff/parse.js";
import type { ClockPort, GitPort } from "../ports.js";
import { inputHash, type CheckIdentity, type HashedFile } from "../receipts/hash.js";
import { recordPass, shouldSkip, type Receipt } from "../receipts/receipt.js";
import { aggregate } from "./aggregate.js";
import type { CheckRun } from "./outcomes.js";
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
) => Promise<CheckRun>;

export interface GatePorts {
  /** `GitPort.hashFile` — content hash at the working tree. */
  readonly hashFile: GitPort["hashFile"];
  readonly clock: ClockPort;
  readonly receipts: ReceiptStore;
  readonly runCheck: CheckRunner;
  /**
   * Where per-check progress is recorded. OPTIONAL, and the asymmetry with
   * `appendSignals`' required-but-nullable `branch` is deliberate: a signal with no
   * branch is a RECORD MISSING A FIELD, so a caller has to answer for it, whereas a
   * gate with no sink simply produces no log. Omitting it costs observability, not
   * correctness, and the verdict is byte-identical either way.
   */
  readonly events?: EventSink;
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

/**
 * What goes into the receipt hash on the CHECK's side.
 *
 * Built in one place so the hash the gate compares against and the hash `recordPass`
 * mints are the same function of the same check. Two constructions of this object
 * would be two chances to disagree, and a disagreement here means either a receipt
 * that never matches (harmless, wasteful) or one that matches when it should not
 * (a false PASS).
 */
export const identityOf = (check: LoadedCheck): CheckIdentity => ({
  version: check.version,
  ...(check.command !== undefined ? { command: check.command } : {}),
  ...(check.review_lens !== undefined ? { reviewLens: check.review_lens } : {}),
});

/** What one selected check needs before it can be run or skipped. */
/** A selected check bundled with the input its receipt is keyed on. */
interface CheckWithInput {
  readonly check: LoadedCheck;
  readonly files: readonly ChangedFile[];
  /** Each matched file with its content hash. `null` when one could not be read. */
  readonly hashedFiles: readonly HashedFile[] | null;
  /** Those hashes plus the check's identity, as one digest. `null` when unhashable. */
  readonly inputHash: string | null;
}

export async function runGate(input: GateInput, ports: GatePorts): Promise<GateRun> {
  const { routing, registry, files } = input;
  const emit = ports.events ?? NULL_SINK;
  const selection = selectChecks(routing, registry, files);

  const results = new Map<string, CheckResult>();

  // Routing named a check that does not exist: a stale routing table, or a check
  // file someone deleted. We do not know its severity, so we assume the worst —
  // `block` — precisely to demonstrate that it STILL does not block. `errored` is
  // never consulted for severity.
  for (const checkId of selection.missingFromRegistry) {
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
  const pendingHashes = new Map<string, Promise<string>>();
  const hashOf = (file: ChangedFile): Promise<string> => {
    if (file.status === "deleted") return Promise.resolve(DELETED_FILE_HASH);
    const existing = pendingHashes.get(file.path);
    if (existing !== undefined) return existing;
    const pending = ports.hashFile(file.path);
    pendingHashes.set(file.path, pending);
    return pending;
  };

  const prepared: CheckWithInput[] = [];
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
      hashedFiles: hashed,
      inputHash: hashed === null ? null : inputHash(hashed, identityOf(selected.check)),
    });
  }

  // ── the receipt skip ──────────────────────────────────────────────────────
  const toRun: CheckWithInput[] = [];
  for (const item of prepared) {
    // A method is not verification, so it has nothing to cache. Nothing mints a
    // receipt for one (they never pass), but a receipt is plain JSON that whoever
    // produced the diff could write — and honouring it would report the method as
    // `skipped: receipt`, which counts as something having been verified and would
    // headline the run `passed` without the method ever appearing.
    if (item.check.kind === "method") {
      toRun.push(item);
      continue;
    }

    if (item.inputHash === null) {
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

    if (shouldSkip(receipt, item.inputHash).skip) {
      // The one skip worth recording. `selection.excluded` is a check that was never
      // going to run on this change; a RECEIPT skip is the gate choosing not to
      // re-verify something, which is the decision a reader of this log will want to
      // second-guess.
      emit({
        kind: "check-skipped",
        detail: `\`${item.check.id}\` skipped — a receipt covers this input`,
        check: item.check.id,
        status: "skipped",
      });
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
  const runOne = async (item: CheckWithInput): Promise<CheckResult> => {
    const started = ports.clock.now().getTime();
    let outcome: CheckRun;
    try {
      outcome = await ports.runCheck(item.check, item.files);
    } catch (cause) {
      outcome = {
        outcome: {
          status: "errored",
          detail: `the check could not be run: ${detailOf(cause)}`,
        },
      };
    }
    const durationMs = Math.max(0, ports.clock.now().getTime() - started);

    // Emitted here rather than in the results loop below, so the line lands when the
    // check actually finished. The results are re-sorted into routing order before
    // they are returned — a log built from them would report a chronology that never
    // happened, and this log's only job is to say what happened when.
    emit({
      kind: "check-finished",
      detail: `\`${item.check.id}\` (v${item.check.version}) ${outcome.outcome.status}`,
      check: item.check.id,
      status: outcome.outcome.status,
      ms: durationMs,
    });

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
  const lenses = toRun.filter((item) => item.check.kind === "llm");
  // Everything else is a `method` (adr-0018) — prose an agent follows, which this
  // does not run and must not drop. The first version filtered for the two kinds
  // it knew and let a selected method vanish between them, which is worse than
  // not supporting it: the run said `passed` and never mentioned it.
  // Selected by NAME. Written as "everything that is not the other two", a fourth
  // kind would silently land here and be reported `declared` — the same vanishing
  // this loop exists to prevent, one kind further along.
  const methods = toRun.filter((item) => item.check.kind === "method");

  for (const item of methods) {
    results.set(item.check.id, {
      checkId: item.check.id,
      checkVersion: item.check.version,
      severity: item.check.severity,
      outcome: { status: "declared" },
      durationMs: 0,
    });
  }

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
    if (item.hashedFiles === null) continue; // no describable input, no receipt
    if (results.get(item.check.id)?.outcome.status !== "pass") continue;

    try {
      await ports.receipts.write(
        recordPass({
          checkId: item.check.id,
          check: identityOf(item.check),
          files: item.hashedFiles,
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
