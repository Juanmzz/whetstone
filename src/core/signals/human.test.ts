import { describe, expect, it } from "vitest";
import { humanSignal } from "./human.js";
import { parseSignalLog } from "./parse.js";

const NOW = new Date("2026-08-10T15:04:05.000Z");

const observation = {
  type: "triage-miss",
  phase: "verify",
  severity: "medium",
  detail: "Auth middleware change classified light; it should have been strict.",
  ruleAffected: [] as readonly string[],
  branch: "run/two-related-repairs" as string | null,
};

const ok = (over: Partial<typeof observation> = {}) => {
  const result = humanSignal({ ...observation, ...over }, NOW);
  if (!result.ok) throw new Error(`expected ok, got: ${result.errors.join("; ")}`);
  return result.record;
};

const errors = (over: Partial<typeof observation>): readonly string[] => {
  const result = humanSignal({ ...observation, ...over }, NOW);
  return result.ok ? [] : result.errors;
};

describe("humanSignal", () => {
  it("builds a record the log's own parser accepts", () => {
    // The one test that matters. A human types the command at the moment they
    // have the observation; if what comes out does not survive `parseSignalLog`,
    // the next retro refuses to load the file and the observation is worse than
    // never recorded.
    const [parsed] = parseSignalLog(JSON.stringify(ok()));
    expect(parsed?.type).toBe("triage-miss");
    expect(parsed?.severity).toBe("medium");
  });

  it("stamps the clock it was given, never one of its own", () => {
    expect(ok().ts).toBe(NOW.toISOString());
  });

  it("carries the branch it was handed", () => {
    expect(ok().branch).toBe("run/two-related-repairs");
  });

  it("omits branch on a detached HEAD rather than writing a null", () => {
    expect("branch" in ok({ branch: null })).toBe(false);
  });

  it("marks the record as human-authored, distinct from the gate's own", () => {
    // The whole reason the command exists: a human's observation is the best
    // evidence the log gets, and it should not be indistinguishable from the
    // agent commentary that makes up most of the existing entries.
    expect(ok().source).toBe("human");
  });

  it("carries no fingerprint — dedupe is the gate's mechanism, not a human's", () => {
    // A fingerprint in the log means "an open signal at this identity"; the gate
    // drops candidates matching one. A human record wearing one would silence a
    // machine signal that was never recorded.
    expect("fingerprint" in ok()).toBe(false);
  });

  it("gives two observations recorded at different moments different ids", () => {
    const later = humanSignal(observation, new Date("2026-08-10T16:00:00.000Z"));
    expect(later.ok && later.record.id).not.toBe(ok().id);
  });

  it("gives an id shaped like every other id in the log", () => {
    expect(ok().id).toMatch(/^sig-[0-9a-f]{8}$/);
  });

  it("keeps the rules the human named, and defaults to an empty list", () => {
    expect(ok({ ruleAffected: ["skills/recording.md"] }).rule_affected).toEqual([
      "skills/recording.md",
    ]);
    expect(ok().rule_affected).toEqual([]);
  });

  it("trims the detail and the type instead of writing the shell's whitespace", () => {
    const record = ok({ type: "  triage-miss  ", detail: "  something happened  " });
    expect(record.type).toBe("triage-miss");
    expect(record.detail).toBe("something happened");
  });

  describe("rejects rather than writes", () => {
    it("a severity outside the scale, without inventing one", () => {
      // `cluster` treats a lone `high` as actionable on its own and branches on
      // nothing else. An unrecognised severity is a signal the retro cannot rank.
      expect(errors({ severity: "urgent" }).join()).toMatch(/severity/);
      expect(errors({ severity: "HIGH" }).join()).toMatch(/severity/);
    });

    it("a type that is not kebab-case, because the type IS a cluster key", () => {
      // `clusterSignals` buckets on `type:<name>`. "Triage Miss" and "triage-miss"
      // are two clusters over one problem, and neither one recurs.
      for (const bad of ["Triage Miss", "triage_miss", "triage--miss", "-triage", ""]) {
        expect(errors({ type: bad }).join()).toMatch(/type/);
      }
    });

    it("an empty detail — a signal nobody can reconstruct is not evidence", () => {
      expect(errors({ detail: "   " }).join()).toMatch(/detail/);
    });

    it("an empty phase", () => {
      expect(errors({ phase: " " }).join()).toMatch(/phase/);
    });

    it("and reports EVERY problem at once, not the first one", () => {
      // A human recording an observation is mid-thought. Three round trips to
      // learn three things is how the command stops being used.
      expect(errors({ severity: "urgent", type: "Nope", detail: "" })).toHaveLength(3);
    });
  });

  it("accepts a phase the spec's vocabulary does not list", () => {
    // The real log already carries `dispatch` and `retro`. A closed vocabulary
    // here would reject entries this project has been writing for a month.
    expect(ok({ phase: "dispatch" }).phase).toBe("dispatch");
  });
});
