import { describe, expect, it } from "vitest";
import { prepareEnvelope } from "./machine.js";

const base = {
  task: "add the thing",
  leased: true,
  worktreePath: "/repos/acme/.worktrees/add-the-thing",
  branch: "run/add-the-thing",
  charterPath: "/repos/acme/.worktrees/add-the-thing/.wst-charter.md",
  lane: null,
  laneGuard: false,
  gaps: [],
};

describe("prepareEnvelope — what an orchestrator needs back", () => {
  it("returns the three paths it would otherwise have to parse out of prose", () => {
    const env = prepareEnvelope(base);

    expect(env.worktree).toBe("/repos/acme/.worktrees/add-the-thing");
    expect(env.branch).toBe("run/add-the-thing");
    expect(env.charter).toBe("/repos/acme/.worktrees/add-the-thing/.wst-charter.md");
  });

  it("says whether the lane is enforced, never just that a lane exists", () => {
    // The charter's promise was the defect: a boundary named and not enforced
    // reads as authoritative. The envelope must not repeat that in data.
    expect(prepareEnvelope({ ...base, lane: "api", laneGuard: false }).lane).toEqual({
      id: "api",
      enforced: false,
    });
  });

  it("returns null for a lane rather than an empty string", () => {
    expect(prepareEnvelope(base).lane).toBeNull();
  });

  it("carries the environment gaps, since a caller may want to close them", () => {
    const env = prepareEnvelope({
      ...base,
      gaps: [{ kind: "absent-environment" as const, paths: [".env"], why: "ignored, so it does not travel" }],
    });

    expect(env.missing).toEqual([{ kind: "absent-environment", paths: [".env"] }]);
  });

  it("says plainly that nothing was dispatched, which is the whole contract", () => {
    // adr-0014: prepare leases and stops. A caller that assumed otherwise would
    // wait forever for a process that was never started.
    expect(prepareEnvelope(base).dispatched).toBe(false);
  });
  it("has no worktree and no charter path under a dry run, because nothing was leased", () => {
    // The paths do not exist yet. Emitting a placeholder string where a consumer
    // expects a path is how it ends up calling open() on "<leased when you run
    // this for real>".
    const env = prepareEnvelope({ ...base, leased: false, charterText: "# charter" });

    expect(env.leased).toBe(false);
    expect(env.worktree).toBeNull();
    expect(env.charter).toBeNull();
  });

  it("carries the dry run charter as text under its own key, never as `charter`", () => {
    // `charter` meant the PATH in one mode and the TEXT in the other — one key,
    // two types, one command. A consumer cannot branch on a type it must guess.
    const env = prepareEnvelope({ ...base, leased: false, charterText: "# charter" });

    expect(env.charterPreview).toBe("# charter");
  });

  it("leaves the preview null once something was actually leased", () => {
    // There is a file to read by then, and two copies of a charter that can drift
    // is the defect this envelope exists to avoid.
    const env = prepareEnvelope({ ...base, leased: true });

    expect(env.leased).toBe(true);
    expect(env.charterPreview).toBeNull();
    expect(env.charter).toBe("/repos/acme/.worktrees/add-the-thing/.wst-charter.md");
  });
});
