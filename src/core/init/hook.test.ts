import { describe, expect, it } from "vitest";
import { renderPrePushHook } from "./hook.js";

const HOOK = renderPrePushHook();

describe("renderPrePushHook — what git runs before a push", () => {
  it("derives a range from what git is pushing, never gating a bare working tree", () => {
    // With no --range the gate compares the working tree to HEAD. At pre-push
    // time the tree is clean, so it finds nothing, reports INCOMPLETE and exits
    // 2 — blocking every push regardless of content.
    expect(HOOK).toMatch(/--range/);
    expect(HOOK).not.toMatch(/wst gate\s+--no-lens\s*$/m);
  });

  it("runs deterministic checks only", () => {
    // A hook that costs money and fifty seconds gets bypassed with --no-verify,
    // and a routed-around gate is worth less than no gate.
    expect(HOOK).toContain("--no-lens");
  });

  it("lets a teammate who has not installed wst push", () => {
    expect(HOOK).toMatch(/command -v wst .*\|\| exit 0/);
  });

  it("skips a branch deletion and a tag, which have no diff to gate", () => {
    expect(HOOK).toMatch(/0{40}/);
    expect(HOOK).toContain("refs/tags/");
  });

  it("keeps the real exit code rather than collapsing it to 0", () => {
    // `if ! cmd` resets $? to 0 and makes the exit-2 branch unreachable.
    expect(HOOK).toContain("|| code=$?");
    expect(HOOK).not.toMatch(/if ! wst gate/);
  });

  it("gives exit 2 its own sentence, never merged with a failed check", () => {
    // Hard rule 3: a check that could not RUN is the gate being broken, not a
    // verdict. The two may never share a message.
    const broke = HOOK.slice(HOOK.indexOf('"$code" -eq 2'));
    const sentence = broke.slice(0, broke.indexOf("else"));
    expect(sentence).toMatch(/NOT verified/);
    expect(sentence).not.toMatch(/failed/);
  });

  it("starts with a shebang, so git can execute it", () => {
    expect(HOOK.startsWith("#!/bin/sh\n")).toBe(true);
  });

  it("names no file of Whetstone's own, which would dangle in a bootstrapped repo", () => {
    expect(HOOK).not.toMatch(/\.wst\/(?!memory)/);
    expect(HOOK).not.toContain("whetstone/src");
  });
});

import type { ClockPort } from "../ports.js";
import type { RepoFacts } from "./detect.js";
import { NO_RISK, type InterviewAnswers } from "./interview.js";
import { planInit } from "./plan.js";

const clock: ClockPort = { now: () => new Date("2026-08-25T12:00:00Z") };
const facts: RepoFacts = {
  repoName: "acme",
  files: ["package.json", "src/index.ts"],
  packageJson: { scripts: { test: "vitest run" } },
  commitSubjects: [],
  contributors: null,
};
const answers: InterviewAnswers = {
  purpose: "A billing service.",
  risk: NO_RISK,
  sourcePaths: ["src/**"],
  strictPaths: [],
  stack: "TypeScript on Node.",
};

describe("planInit — the enforcement surface ships with the definitions", () => {
  it("writes the pre-push hook, executable", () => {
    // The README's claim is that the exit code is what enforces. init wrote
    // everything BUT the hook that produces it, so a repo bootstrapped outside
    // Claude Code had nothing to arm.
    const plan = planInit({ facts, answers, clock });
    const hook = plan.files.find((f) => f.path === ".githooks/pre-push");
    expect(hook?.executable).toBe(true);
    expect(hook?.contents).toContain("wst gate --no-lens --range");
  });

  it("tells the human to arm it, because arming is not init's to do", () => {
    // `core.hooksPath` takes ONE value. Setting it here would silently disarm
    // husky, which is a worse outcome than an unarmed hook.
    const plan = planInit({ facts, answers, clock });
    expect(plan.notes.join("\n")).toMatch(/core\.hooksPath/);
  });

  it("withholds it under --definitions-only, which asked for .wst/ and nothing else", () => {
    const plan = planInit({ facts, answers, clock, options: { definitionsOnly: true } });
    expect(plan.files.map((f) => f.path)).not.toContain(".githooks/pre-push");
  });
});
