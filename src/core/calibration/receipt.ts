/**
 * The calibration receipt. PURE.
 *
 * ## What this replaces, and why it had to
 *
 * `AGENTS.md` non-negotiable 2 reads: *"A judgment check earns its `block` — enforced
 * by the SCHEMA."* Until this module, the schema asked one question — does the YAML say
 * `status: passed` with `runs >= 1`? Two hand-typed fields.
 *
 * That was demonstrated, not theorised: editing three lines of
 * `.wst/checks/correctness.md` in a text editor took a lens sitting at
 * `uncalibrated`, `runs: 0` and loaded it at `severity: block`. No measurement ran.
 * The one property an outside survey could not find in any comparable tool was, in
 * practice, an honour-system checkbox.
 *
 * A receipt is not a claim about a measurement. It is a set of FINGERPRINTS of what
 * was measured, and the schema recomputes them from the current state. Forging it
 * means guessing a sha256 of a prompt and of a fixture set, which is the same as
 * running the measurement.
 *
 * ## Same object as a gate receipt, one level up
 *
 *   gate receipt          "check X passed on exactly THIS INPUT"
 *                          bound by: file hashes + check identity
 *
 *   calibration receipt   "lens X held on exactly THESE FIXTURES"
 *                          bound by: fixture-set hash + lens hash + model + runtime
 *
 * And the same consequence, which is the point: change the thing and the binding
 * breaks by itself. `sig-0028` put a check's `command` into its gate receipt because
 * trusting a human to bump a version number did not hold. `correctness.md` carries the
 * same warning today as PROSE — *"Changing the lens INVALIDATES the previous
 * measurement"* — addressed to someone who has to remember it. A hash does not need
 * to be remembered.
 *
 * Why a re-derivable receipt rather than a report: adr-0011.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

/** One fixture as it exists right now: its ground truth and its content. */
export interface FixtureFile {
  readonly path: string;
  readonly expected: "pass" | "fail";
  /** Content hash. A fixture edited in place is a different measurement. */
  readonly hash: string;
}

const OUTCOME = z.enum(["pass", "fail", "errored"]);

const ResultSchema = z.strictObject({
  fixture: z.string().min(1),
  expected: z.enum(["pass", "fail"]),
  /** One entry per run, in order. */
  got: z.array(OUTCOME),
});

export type CalibrationResult = z.infer<typeof ResultSchema>;

export const CALIBRATION_FORMAT = 1;

/**
 * Runs per fixture before a clean sweep grants anything.
 *
 * NOT a taste number. Measured on this repo's own `correctness` lens, an hour apart,
 * same prompt and same fixtures:
 *
 *   --runs 10  ->  race-good flipped once  ->  failed
 *   --runs  2  ->  10/10 clean             ->  passed
 *
 * Both receipts were genuine, both carried true hashes, and the second was worthless.
 * It was produced by accident while testing the plumbing, and it overwrote the honest
 * failing one — which is exactly how this would happen to a user.
 *
 * Without a floor, the honour-system hole this whole module replaced simply comes
 * back wearing a hash: instead of typing `status: passed`, you run `--runs 1`.
 *
 * 10 is what the bar in `test/fixtures/lens-correctness/RESULT.md` has used since the
 * first measurement, and it is the smallest sample that has actually caught the flip
 * this lens has. It is a floor, not a proof — a lens that fails one time in fifty
 * passes this and is still flaky.
 */
export const MIN_AUTHORISING_RUNS = 10;

const Shape = z.strictObject({
  format: z.literal(CALIBRATION_FORMAT),
  checkId: z.string().min(1),
  lensHash: z.string().length(64),
  fixturesHash: z.string().length(64),
  model: z.string().min(1),
  runtime: z.strictObject({ name: z.string().min(1), version: z.string().min(1) }),
  runs: z.number().int().min(1),
  results: z.array(ResultSchema).min(1),
  verdict: z.enum(["passed", "failed"]),
  measuredAt: z.string(),
});

/**
 * The receipt as read back from disk.
 *
 * `verdict` is RE-DERIVED during parsing and the parse fails if the file disagrees
 * with its own results. Without that, the file is a claim again — someone edits
 * `"failed"` to `"passed"` and the fingerprints, which are all genuine, vouch for it.
 */
export const CalibrationReceiptSchema = Shape.superRefine((r, ctx) => {
  if (deriveVerdict(r.results) !== r.verdict) {
    ctx.addIssue({
      code: "custom",
      path: ["verdict"],
      message:
        `verdict "${r.verdict}" does not follow from these results — a calibration ` +
        `receipt records what happened; it does not get to disagree with it`,
    });
  }
});

export type CalibrationReceipt = z.infer<typeof Shape>;

export function lensHash(lens: string): string {
  return createHash("sha256").update(`wst.lens/1\n${lens}`, "utf8").digest("hex");
}

/**
 * The fixture set, canonically.
 *
 * Sorted, so the order a directory listing happens to return cannot move the hash.
 * The EXPECTATION is hashed alongside the content: the same files with the ground
 * truth flipped is a different measurement, and a receipt must not carry across it.
 */
export function fixturesHash(fixtures: readonly FixtureFile[]): string {
  const lines = [...fixtures]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}\0${f.expected}\0${f.hash}`);
  return createHash("sha256")
    .update(`wst.fixtures/1\nn:${String(lines.length)}\n${lines.join("\n")}\n`, "utf8")
    .digest("hex");
}

/**
 * Passed iff EVERY run on EVERY fixture matched its expectation.
 *
 * No score, no threshold, no "9/10 is fine". A lens that flips once has shown it can
 * flip, and the cost of a flaky blocking check is that people route around the gate —
 * at which point its value is negative (non-negotiable 7). `errored` counts against:
 * it is the judge being broken rather than the lens being wrong, but it is equally
 * not evidence of the stability this receipt exists to evidence.
 */
function deriveVerdict(results: readonly CalibrationResult[]): "passed" | "failed" {
  for (const r of results) {
    if (r.got.length === 0) return "failed";
    if (r.got.some((got) => got !== r.expected)) return "failed";
  }
  return "passed";
}

export interface CalibrationInput {
  readonly checkId: string;
  /** The exact `review_lens` text that was measured. */
  readonly lens: string;
  readonly fixtures: readonly FixtureFile[];
  readonly model: string;
  readonly runtime: { readonly name: string; readonly version: string };
  readonly results: readonly CalibrationResult[];
  readonly at: Date;
}

/**
 * The one and only way to mint a receipt.
 *
 * It computes the hashes and the verdict itself rather than accepting them, for the
 * same reason `recordPass` computes its own input hash: a caller that supplies both a
 * measurement and a conclusion can supply two that disagree.
 */
export function recordCalibration(input: CalibrationInput): CalibrationReceipt {
  const covered = new Set(input.results.map((r) => r.fixture));
  const missing = input.fixtures.filter((f) => !covered.has(f.path)).map((f) => f.path);
  if (missing.length > 0) {
    throw new Error(
      `refusing to mint a calibration receipt: no result for fixture(s) ${missing.join(", ")} — ` +
        `a receipt that covers part of the set would vouch for the whole of it`,
    );
  }

  const runs = Math.min(...input.results.map((r) => r.got.length));
  if (runs < 1) {
    throw new Error(
      "refusing to mint a calibration receipt with zero runs — nothing was measured",
    );
  }

  return {
    format: CALIBRATION_FORMAT,
    checkId: input.checkId,
    lensHash: lensHash(input.lens),
    fixturesHash: fixturesHash(input.fixtures),
    model: input.model,
    runtime: input.runtime,
    runs,
    results: input.results.map((r) => ({ ...r, got: [...r.got] })),
    verdict: deriveVerdict(input.results),
    measuredAt: input.at.toISOString(),
  };
}

export type AuthorityDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * May this lens hold `severity: block`?
 *
 * Every ambiguity denies. A lens wrongly held at `warn` costs an advisory finding; a
 * lens wrongly granted `block` stops other people's work on an unmeasured judgement,
 * which is the failure the whole mechanism exists to prevent.
 */
export function blockAuthority(
  lens: string,
  receipt: CalibrationReceipt | null | undefined,
  currentFixturesHash: string,
): AuthorityDecision {
  if (receipt === null || receipt === undefined) {
    return {
      ok: false,
      reason: "no calibration receipt — run `npm run calibrate`, or drop it to `warn`",
    };
  }
  if (receipt.lensHash !== lensHash(lens)) {
    return {
      ok: false,
      reason:
        "the lens text changed since it was measured, so the receipt describes a " +
        "different prompt — re-measure it",
    };
  }
  if (receipt.fixturesHash !== currentFixturesHash) {
    return {
      ok: false,
      reason:
        "the fixture set changed since it was measured — the receipt describes a " +
        "different measurement",
    };
  }
  if (receipt.verdict !== "passed") {
    return { ok: false, reason: "the calibration did not pass" };
  }
  if (receipt.runs < MIN_AUTHORISING_RUNS) {
    return {
      ok: false,
      reason:
        `too few runs: ${String(receipt.runs)} per fixture, and ${String(MIN_AUTHORISING_RUNS)} ` +
        `are required before a clean sweep means anything`,
    };
  }
  return { ok: true };
}
