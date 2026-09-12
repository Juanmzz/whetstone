import { describe, expect, it } from "vitest";
import {
  AGENTS_STANZA_MARKER,
  agentsStanzaPresent,
  renderAgentsStanza,
  renderPrePushHook,
} from "./enforcement.js";

/**
 * What `init` writes is a definition; what makes anything run is separate, and until
 * 2026-09-12 nothing offered it. `status` meanwhile reported the pre-push gate as
 * missing, so the tool asked for something it never handed over.
 */
describe("the pre-push hook a target repo gets", () => {
  const hook = renderPrePushHook();

  it("calls `gate`, not `ready`", () => {
    // adr-0021: "nothing covers this" may not block a push, and `ready` answers
    // INCOMPLETE there (adr-0048). A hook on `ready` would refuse a docs-only push,
    // which is the pressure that teaches --no-verify.
    expect(hook).toContain("wst gate");
    expect(hook).not.toMatch(/\bwst ready\b/);
  });

  it("skips branch deletions and tags", () => {
    expect(hook).toContain("0000000000000000000000000000000000000000");
    expect(hook).toContain("refs/tags/");
  });

  it("keeps could-not-run separate from failed", () => {
    // Hard rule 3 reaches the hook: exit 2 is the gate being broken, and a message
    // that blames the change for it sends someone to fix the wrong thing.
    expect(hook).toContain('-eq 2');
    expect(hook).toMatch(/could not run/i);
  });

  it("says how to arm it, because writing it does not", () => {
    expect(hook).toContain("core.hooksPath");
  });

  it("is a bash script with the safety flags", () => {
    expect(hook.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(hook).toContain("set -euo pipefail");
  });

  it("uses no em-dash", () => {
    expect(hook).not.toContain("—");
  });
});

describe("the stanza an agent reads", () => {
  const stanza = renderAgentsStanza();

  it("names the command and what its exit codes mean", () => {
    expect(stanza).toContain("wst ready");
    expect(stanza).toMatch(/\b1\b/);
    expect(stanza).toMatch(/\b2\b/);
  });

  it("separates a failed check from one that could not run", () => {
    expect(stanza).toMatch(/could not run/i);
  });

  it("carries a marker, so a re-run can tell it is already there", () => {
    expect(stanza).toContain(AGENTS_STANZA_MARKER);
  });

  it("uses no em-dash", () => {
    expect(stanza).not.toContain("—");
  });
});

describe("agentsStanzaPresent", () => {
  it("finds the stanza in a file that has it", () => {
    expect(agentsStanzaPresent(`# Rules\n\n${renderAgentsStanza()}`)).toBe(true);
  });

  it("does not find it in a file that does not", () => {
    expect(agentsStanzaPresent("# Rules\n\nRun the tests.\n")).toBe(false);
  });

  it("treats a missing file as absent rather than throwing", () => {
    expect(agentsStanzaPresent(null)).toBe(false);
  });
});
