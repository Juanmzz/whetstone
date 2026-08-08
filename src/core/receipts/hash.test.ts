import { describe, expect, it } from "vitest";
import { canonicalInput, inputHash, sha256Hex, type Digest, type HashedFile } from "./hash.js";

const files = (...pairs: readonly (readonly [string, string])[]): HashedFile[] =>
  pairs.map(([path, hash]) => ({ path, hash }));

const A = ["src/a.ts", "1111111111111111111111111111111111111111"] as const;
const B = ["src/b.ts", "2222222222222222222222222222222222222222"] as const;

describe("inputHash", () => {
  it("is stable across calls with the same inputs", () => {
    expect(inputHash(files(A, B), 1)).toBe(inputHash(files(A, B), 1));
  });

  it("does not depend on the order the files arrive in", () => {
    // The gate collects matched files from a glob walk; iteration order is not a
    // guarantee it can make. If order moved the hash, every run would miss.
    expect(inputHash(files(A, B), 1)).toBe(inputHash(files(B, A), 1));
  });

  it("changes when a file's content hash changes", () => {
    expect(inputHash(files(A), 1)).not.toBe(inputHash(files(["src/a.ts", "ffff"]), 1));
  });

  it("changes when a file is added to the set", () => {
    expect(inputHash(files(A), 1)).not.toBe(inputHash(files(A, B), 1));
  });

  it("keeps each content hash bound to its own path", () => {
    // Guards the classic bug: sorting paths and hashes independently, or hashing
    // the concatenated content hashes and dropping the paths. Both make these two
    // sets collide, so renaming a file across a swap would reuse a stale receipt.
    const straight = files([A[0], A[1]], [B[0], B[1]]);
    const swapped = files([A[0], B[1]], [B[0], A[1]]);
    expect(inputHash(straight, 1)).not.toBe(inputHash(swapped, 1));
  });

  it("distinguishes a path split across the delimiter", () => {
    // A naive `path + hash` concatenation makes these two indistinguishable.
    expect(inputHash(files(["ab", "cd"]), 1)).not.toBe(inputHash(files(["a", "bcd"]), 1));
  });

  it("hashes the empty file set to something stable and non-empty", () => {
    const empty = inputHash([], 1);
    expect(empty).toBe(inputHash([], 1));
    expect(empty).not.toBe(inputHash(files(A), 1));
  });

  it("rejects duplicate paths rather than hashing ambiguous input", () => {
    // Two hashes for one path means the caller is confused. Hashing it anyway
    // would mint a receipt that looks authoritative and is not.
    expect(() => inputHash(files(A, ["src/a.ts", "ffff"]), 1)).toThrow(/duplicate/i);
  });

  it("returns a lowercase hex sha256 by default", () => {
    expect(inputHash(files(A), 1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("delegates to an injected digest, so the canonical form is testable", () => {
    const digest: Digest = () => "stubbed";
    expect(inputHash(files(A), 1, digest)).toBe("stubbed");
  });
});

describe("sha256Hex", () => {
  it("is a pure function of its input", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
    // Known-answer test: pins the algorithm so a "harmless" swap to md5/sha1
    // cannot happen silently and invalidate every receipt already on disk.
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

/**
 * THE RULE THIS LANE EXISTS TO PROTECT.
 *
 * A receipt says "check X already passed on this input". If the hash ignores the
 * check's `version`, then editing the check's behaviour leaves every old receipt
 * still matching — and the gate reports "already passed" for a check that has never
 * once run in its current form. That is a silently broken gate, which is worse than
 * no gate: it is trusted.
 *
 * These tests fail if anyone drops `checkVersion` from the hash input.
 */
describe("the check-version binding", () => {
  it("changes the hash when only the check version changes", () => {
    expect(inputHash(files(A, B), 2)).not.toBe(inputHash(files(A, B), 1));
  });

  it("gives every version a distinct hash", () => {
    const seen = new Set<string>();
    for (let v = 1; v <= 25; v++) seen.add(inputHash(files(A, B), v));
    expect(seen.size).toBe(25);
  });

  it("feeds the version to the digest, not just to a wrapper", () => {
    // Stronger than comparing two digests: it proves the version reaches the bytes
    // that are hashed. An implementation that mixed the version in AFTER digesting
    // would pass the test above and still be wrong for anyone supplying a digest.
    let seen = "";
    const recording: Digest = (input) => {
      seen = input;
      return "x";
    };
    inputHash(files(A), 7, recording);
    expect(seen).toContain("7");
    expect(canonicalInput(files(A), 7)).toBe(seen);
  });

  it("cannot be satisfied by a file change that happens to look like a version bump", () => {
    // The version lives in its own field of the canonical form, so no arrangement
    // of file paths or content hashes can forge it.
    expect(canonicalInput(files(["v", "2"]), 1)).not.toBe(canonicalInput(files(["v", "1"]), 2));
  });
});

describe("canonicalInput", () => {
  it("is versioned, so a future format change invalidates old receipts", () => {
    // Without a format tag, changing the serialization silently reuses receipts
    // computed under the old one — the same failure mode as dropping the version.
    expect(canonicalInput([], 1).startsWith("wst-receipt/1\n")).toBe(true);
  });

  it("sorts by path so the serialization is order-independent", () => {
    expect(canonicalInput(files(B, A), 1)).toBe(canonicalInput(files(A, B), 1));
  });
});
