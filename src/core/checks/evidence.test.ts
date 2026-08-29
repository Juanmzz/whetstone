/**
 * The line this check must not cross: it decides whether an artifact IS there,
 * never whether what it shows is good (adr-0036).
 */

import { describe, expect, it } from "vitest";
import {
  EVIDENCE_DIR,
  evidenceDir,
  isMachineReadable,
  judgeEvidence,
  type FoundEvidence,
} from "./evidence.js";

const file = (over: Partial<FoundEvidence> = {}): FoundEvidence => ({
  name: "shot.png",
  bytes: 4096,
  mtimeMs: 2000,
  text: null,
  ...over,
});

describe("evidenceDir", () => {
  it("puts the store BESIDE the repo, never inside it", () => {
    const dir = evidenceDir("/home/dev/whetstone", "main", "evidence-launcher");

    expect(dir).toBe(`/home/dev/${EVIDENCE_DIR}/whetstone/main/evidence-launcher`);
    expect(dir.startsWith("/home/dev/whetstone/")).toBe(false);
  });

  it("keys by branch, because two branches have different evidence", () => {
    const a = evidenceDir("/r/app", "feat/one", "evidence-ui");
    const b = evidenceDir("/r/app", "feat/two", "evidence-ui");

    expect(a).not.toBe(b);
  });

  it("flattens a slashed branch into one directory name", () => {
    expect(evidenceDir("/r/app", "feat/a/b", "e")).toBe(`/r/${EVIDENCE_DIR}/app/feat-a-b/e`);
  });

  it("keeps two requirements on one branch apart", () => {
    expect(evidenceDir("/r/app", "main", "evidence-ui")).not.toBe(
      evidenceDir("/r/app", "main", "evidence-api"),
    );
  });
});

describe("isMachineReadable", () => {
  it("is true for text a check can inspect the shape of", () => {
    expect(isMachineReadable("response.json")).toBe(true);
    expect(isMachineReadable("run.txt")).toBe(true);
    expect(isMachineReadable("server.log")).toBe(true);
  });

  it("is false for what only a human can read", () => {
    expect(isMachineReadable("screen.png")).toBe(false);
    expect(isMachineReadable("walkthrough.mp4")).toBe(false);
  });
});

describe("judgeEvidence", () => {
  it("passes when an artifact is there and nothing outdates it", () => {
    expect(judgeEvidence([file()], 1000)).toEqual({ kind: "present", count: 1 });
  });

  it("fails when the directory holds nothing", () => {
    expect(judgeEvidence([], 1000)).toEqual({ kind: "absent" });
  });

  it("fails on a zero-byte artifact: a touched file is not evidence", () => {
    expect(judgeEvidence([file({ bytes: 0 })], 1000)).toEqual({ kind: "empty", name: "shot.png" });
  });

  it("fails on machine-readable text that is only whitespace", () => {
    expect(judgeEvidence([file({ name: "run.txt", text: "  \n\t\n" })], 1000)).toEqual({
      kind: "empty",
      name: "run.txt",
    });
  });

  it("asserts the SHAPE of json, which stays deterministic", () => {
    const verdict = judgeEvidence([file({ name: "response.json", text: "{oops" })], 1000);

    expect(verdict.kind).toBe("malformed");
  });

  it("reads an empty json body as saying nothing", () => {
    expect(judgeEvidence([file({ name: "response.json", text: "{}" })], 1000)).toEqual({
      kind: "empty",
      name: "response.json",
    });
  });

  it("does not parse a screenshot: only a human reads that", () => {
    expect(judgeEvidence([file({ name: "screen.png", text: null })], 1000).kind).toBe("present");
  });

  it("fails when every artifact predates the code it claims to show", () => {
    const verdict = judgeEvidence([file({ mtimeMs: 1000 })], 3000);

    expect(verdict).toEqual({ kind: "stale", name: "shot.png", behindMs: 2000 });
  });

  it("passes when ONE artifact is current, whatever else sits beside it", () => {
    const stale = file({ name: "old.png", mtimeMs: 10 });
    const fresh = file({ name: "new.png", mtimeMs: 5000 });

    expect(judgeEvidence([stale, fresh], 3000)).toEqual({ kind: "present", count: 2 });
  });

  it("skips freshness when nothing said how old the code is", () => {
    expect(judgeEvidence([file({ mtimeMs: 1 })], null)).toEqual({ kind: "present", count: 1 });
  });

  it("reports a broken artifact before a stale one: both are true, one is the cause", () => {
    expect(judgeEvidence([file({ bytes: 0, mtimeMs: 1 })], 9000).kind).toBe("empty");
  });
});
