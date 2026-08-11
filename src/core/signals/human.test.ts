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
  attested: true,
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

  describe("the `human` claim is evidenced, never assumed", () => {
    // `source: "human"` is the strongest provenance the log has, and an agent can
    // run this command — `wst` is on a crewmate's PATH. Stamping it from the mere
    // fact that the function was called is the hallucinated-signal-becomes-a-rule
    // path the anti-poisoning gate exists to block.

    it("downgrades the source when nothing evidenced a human", () => {
      expect(ok({ attested: false }).source).toBe("cli");
    });

    it("still records the observation — provenance drops, evidence is not thrown away", () => {
      const record = ok({ attested: false });
      expect(record.detail).toBe(observation.detail);
      expect(parseSignalLog(JSON.stringify(record))).toHaveLength(1);
    });
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

  it("trims the severity too — the one field a stray space used to reject", () => {
    // ` type ` was accepted and `-s high ` was not. Same shell, same accident.
    expect(ok({ severity: " high " }).severity).toBe("high");
  });

  describe("rule_affected, the strongest cluster key", () => {
    // `clusterSignals` buckets on `rule:<path>` VERBATIM and only calls a group of
    // two actionable. Two spellings of one rule are two clusters of one, so the
    // evidence produces nothing — the same failure the kebab-case `type` regex
    // already prevents, on the axis that matters more.

    it("resolves a bare skill filename to the form all 44 existing entries use", () => {
      expect(ok({ ruleAffected: ["recording.md"] }).rule_affected).toEqual(["skills/recording.md"]);
    });

    it("leaves a top-level .wst document where it is", () => {
      // `.wst/triage-rules.md` says of itself "This file **is** retro-amendable".
      // Filing it under skills/ would name a path that does not exist.
      expect(ok({ ruleAffected: ["triage-rules.md"] }).rule_affected).toEqual(["triage-rules.md"]);
    });

    it("normalises the spellings a shell and an editor produce", () => {
      expect(
        ok({ ruleAffected: ["  ./skills/Recording.md ", "/skills/voice.md"] }).rule_affected,
      ).toEqual(["skills/recording.md", "skills/voice.md"]);
    });

    it("collapses two spellings of one rule instead of counting it twice", () => {
      // A duplicate lands the SAME signal in the bucket twice, and `group.length >= 2`
      // then reads one observation as recurrence. That is fabricated evidence.
      expect(ok({ ruleAffected: ["recording.md", "skills/recording.md"] }).rule_affected).toEqual([
        "skills/recording.md",
      ]);
    });

    it("drops what the shell left behind rather than opening an empty cluster", () => {
      expect(ok({ ruleAffected: ["", "   "] }).rule_affected).toEqual([]);
    });

    it("rejects a path that cannot name a rule file under .wst/", () => {
      for (const bad of ["skills/recording", "skills/Recording Notes.md", "../../etc/passwd.md"]) {
        expect(errors({ ruleAffected: [bad] }).join()).toMatch(/rule/);
      }
    });
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
