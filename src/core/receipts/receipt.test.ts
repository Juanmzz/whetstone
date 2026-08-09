import { describe, expect, it } from "vitest";
import { inputHash, type HashedFile } from "./hash.js";
import {
  RECEIPT_FORMAT,
  parseReceipt,
  receiptFileName,
  recordPass,
  shouldSkip,
  type Receipt,
} from "./receipt.js";

const FILES: HashedFile[] = [
  { path: "src/a.ts", hash: "1111111111111111111111111111111111111111" },
  { path: "src/b.ts", hash: "2222222222222222222222222222222222222222" },
];

const AT = new Date("2026-08-07T10:00:00.000Z");

const pass = (over: Partial<Parameters<typeof recordPass>[0]> = {}): Receipt =>
  recordPass({ checkId: "typecheck", check: { version: 1 }, files: FILES, at: AT, ...over });

describe("recordPass", () => {
  it("records the check, the input hash, the outcome and when", () => {
    const receipt = pass();
    expect(receipt).toEqual({
      format: RECEIPT_FORMAT,
      checkId: "typecheck",
      checkVersion: 1,
      inputHash: inputHash(FILES, { version: 1 }),
      matchedFiles: 2,
      outcome: "pass",
      recordedAt: "2026-08-07T10:00:00.000Z",
    });
  });

  it("derives the hash itself, so the stored hash can never disagree with the stored version", () => {
    // If the caller passed both a version and a pre-computed hash, nothing would
    // stop them drifting apart — and a receipt whose hash was earned under v1 while
    // claiming v2 is exactly the bug this lane exists to prevent. There is one
    // constructor and it does the binding.
    expect(pass({ check: { version: 2 } }).inputHash).toBe(inputHash(FILES, { version: 2 }));
    expect(pass({ check: { version: 2 } }).inputHash).not.toBe(pass({ check: { version: 1 } }).inputHash);
  });

  it("is the only way to make a receipt, and it can only say pass", () => {
    // `outcome` is the literal type "pass". Recording a failure is not a policy we
    // remember to follow — it does not typecheck. A receipt is a positive claim;
    // a failed check simply leaves none, and the gate re-runs it.
    const receipt: Receipt = pass();
    expect(receipt.outcome).toBe("pass");
  });
});

describe("shouldSkip", () => {
  it("skips when the recorded hash matches the current one", () => {
    const receipt = pass();
    const decision = shouldSkip(receipt, inputHash(FILES, { version: 1 }));
    expect(decision).toEqual({ skip: true, receipt });
  });

  it("re-runs when there is no receipt", () => {
    expect(shouldSkip(null, inputHash(FILES, { version: 1 }))).toEqual({ skip: false, reason: "no-receipt" });
  });

  it("re-runs when the inputs changed", () => {
    const changed = inputHash([{ path: "src/a.ts", hash: "ffff" }], { version: 1 });
    expect(shouldSkip(pass(), changed)).toEqual({ skip: false, reason: "input-changed" });
  });

  it("re-runs when the check version was bumped", () => {
    // End-to-end proof of the binding: a receipt earned by v1 must not satisfy v2,
    // and it does not, because the version is inside the hash both sides compute.
    const earnedOnV1 = pass({ check: { version: 1 } });
    expect(shouldSkip(earnedOnV1, inputHash(FILES, { version: 2 }))).toEqual({
      skip: false,
      reason: "input-changed",
    });
  });

  it("never skips on a hash that is empty or malformed", () => {
    // Defence in depth: an empty current hash means the caller failed to compute
    // one. Matching it against an equally empty stored value would skip everything.
    const blank = { ...pass(), inputHash: "" } as Receipt;
    expect(shouldSkip(blank, "").skip).toBe(false);
  });
});

describe("parseReceipt", () => {
  const good = JSON.parse(JSON.stringify(pass())) as unknown;

  it("round-trips a receipt through JSON", () => {
    const parsed = parseReceipt(good);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.receipt).toEqual(pass());
  });

  it("refuses a receipt claiming any outcome other than pass", () => {
    // The on-disk file is editable by anyone. A hand-written `outcome: fail` that
    // parsed would let the gate skip a check that failed.
    const tampered = { ...(good as object), outcome: "fail" };
    const parsed = parseReceipt(tampered);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/outcome|pass/i);
  });

  it("refuses a receipt written in a different format version", () => {
    const parsed = parseReceipt({ ...(good as object), format: 99 });
    expect(parsed.ok).toBe(false);
  });

  it("refuses garbage rather than throwing, so a corrupt cache is a miss not a crash", () => {
    for (const junk of [null, undefined, 42, "receipt", [], {}]) {
      expect(parseReceipt(junk).ok).toBe(false);
    }
  });
});

describe("receiptFileName", () => {
  it("names the file after the check id", () => {
    expect(receiptFileName("typecheck")).toBe("typecheck.json");
  });

  it("refuses anything that is not a kebab-case check id", () => {
    // The id reaches a path join. An unvalidated one is a directory traversal, and
    // the shell adapter is meant to be thin enough that it cannot be the guard.
    for (const bad of ["../../etc/passwd", "a/b", "a.b", "", "Typecheck", "a_b"]) {
      expect(() => receiptFileName(bad)).toThrow();
    }
  });
});
