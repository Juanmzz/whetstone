import { describe, expect, it } from "vitest";
import { buildRegistry, type LoadedCheck } from "../checks/registry.js";
import type { Routing } from "../contracts.js";
import type { ChangedFile } from "../diff/parse.js";
import { matchFiles, selectChecks } from "./select.js";

function check(over: Partial<LoadedCheck> = {}): LoadedCheck {
  return {
    id: "typecheck",
    description: "TypeScript compiles.",
    kind: "deterministic",
    severity: "block",
    tiers: ["strict", "light"],
    include: ["src/**/*.ts"],
    exclude: [],
    enabled: true,
    version: 1,
    origin: [],
    command: "npm run typecheck",
    body: "",
    ...over,
  };
}

const routing = (over: Partial<Routing> = {}): Routing => ({
  tier: "strict",
  checks: ["typecheck"],
  autonomy: "human-gate",
  modelTier: "sonnet",
  autofix: false,
  ...over,
});

const file = (path: string, status: ChangedFile["status"] = "modified"): ChangedFile => ({
  path,
  status,
});

const FILES = [file("src/core/gate/select.ts"), file("src/core/gate/select.test.ts"), file("README.md")];

describe("matchFiles", () => {
  it("matches include globs and subtracts exclude globs", () => {
    const matched = matchFiles(check({ exclude: ["src/**/*.test.ts"] }), FILES);
    expect(matched.map((f) => f.path)).toEqual(["src/core/gate/select.ts"]);
  });

  it("matches a file if ANY include glob matches", () => {
    const matched = matchFiles(check({ include: ["docs/**", "README.md"] }), FILES);
    expect(matched.map((f) => f.path)).toEqual(["README.md"]);
  });

  it("preserves the order the files arrived in — the receipt hash must not depend on it", () => {
    const matched = matchFiles(check({ include: ["**/*"] }), FILES);
    expect(matched.map((f) => f.path)).toEqual(FILES.map((f) => f.path));
  });

  it("refuses an empty glob rather than silently matching nothing", () => {
    // node's matchesGlob returns FALSE for a malformed pattern instead of throwing,
    // so a broken glob degrades to "this check matched no files" — a silent hole in
    // the gate. The empty pattern is the one case we can detect cheaply, and the
    // rest are surfaced as `unmatched` rather than hidden.
    expect(() => matchFiles(check({ include: [""] }), FILES)).toThrow(/empty glob/i);
    expect(() => matchFiles(check({ exclude: ["   "] }), FILES)).toThrow(/empty glob/i);
  });
});

describe("selectChecks", () => {
  it("selects an in-tier, enabled check together with exactly the files it matched", () => {
    const registry = buildRegistry([check({ exclude: ["src/**/*.test.ts"] })]);
    const selection = selectChecks(routing(), registry, FILES);

    expect(selection.selected).toHaveLength(1);
    expect(selection.selected[0]?.check.id).toBe("typecheck");
    expect(selection.selected[0]?.files.map((f) => f.path)).toEqual(["src/core/gate/select.ts"]);
    expect(selection.excluded).toEqual([]);
    expect(selection.missingFromRegistry).toEqual([]);
    expect(selection.unmatched).toEqual([]);
  });

  it("reports a disabled check as excluded, not as selected", () => {
    const registry = buildRegistry([check({ enabled: false })]);
    const selection = selectChecks(routing(), registry, FILES);

    expect(selection.selected).toEqual([]);
    expect(selection.excluded).toEqual([
      { checkId: "typecheck", checkVersion: 1, severity: "block", reason: "disabled" },
    ]);
  });

  it("excludes a check whose own `tiers` do not cover the routed tier, even when routing named it", () => {
    // Defence in depth. Routing is the caller's claim about what applies; the check's
    // own declaration is the authority on where it is allowed to run. If they
    // disagree the check does NOT run, and the disagreement is reported.
    const registry = buildRegistry([check({ tiers: ["light"] })]);
    const selection = selectChecks(routing({ tier: "strict" }), registry, FILES);

    expect(selection.selected).toEqual([]);
    expect(selection.excluded).toEqual([
      { checkId: "typecheck", checkVersion: 1, severity: "block", reason: "not-in-tier" },
    ]);
  });

  it("reports `disabled` in preference to `not-in-tier` — the more fundamental reason", () => {
    const registry = buildRegistry([check({ enabled: false, tiers: ["light"] })]);
    const selection = selectChecks(routing({ tier: "strict" }), registry, FILES);
    expect(selection.excluded[0]?.reason).toBe("disabled");
  });

  it("reports a check that matched no changed file as `unmatched` — it never applied", () => {
    // Not a skip and not a failure: the check has nothing to say about this change.
    // Kept out of GateVerdict.skipped on purpose — `CheckOutcome`'s skip reasons are
    // receipt / not-in-tier / disabled, and labelling this with any of them would be
    // a lie. It IS reported, so a glob that matches nothing stays visible.
    const registry = buildRegistry([check({ include: ["docs/**/*.md"] })]);
    const selection = selectChecks(routing(), registry, FILES);

    expect(selection.selected).toEqual([]);
    expect(selection.unmatched).toEqual(["typecheck"]);
  });

  it("reports a routing id the registry does not have as `unknown` — the gate is broken", () => {
    const registry = buildRegistry([check()]);
    const selection = selectChecks(routing({ checks: ["typecheck", "ghost"] }), registry, FILES);

    expect(selection.missingFromRegistry).toEqual(["ghost"]);
    expect(selection.selected.map((s) => s.check.id)).toEqual(["typecheck"]);
  });

  it("ignores registry checks that routing did not name — routing decides what applies", () => {
    const registry = buildRegistry([check(), check({ id: "test", command: "npm test" })]);
    const selection = selectChecks(routing({ checks: ["typecheck"] }), registry, FILES);

    expect(selection.selected.map((s) => s.check.id)).toEqual(["typecheck"]);
    expect(selection.excluded).toEqual([]);
    expect(selection.unmatched).toEqual([]);
  });

  it("de-duplicates repeated routing ids — one result per check, or aggregation is ambiguous", () => {
    const registry = buildRegistry([check()]);
    const selection = selectChecks(routing({ checks: ["typecheck", "typecheck"] }), registry, FILES);
    expect(selection.selected).toHaveLength(1);
  });

  it("preserves routing order, so a gate run over identical inputs reports identically", () => {
    const registry = buildRegistry([
      check(),
      check({ id: "test", command: "npm test" }),
      check({ id: "correctness", kind: "llm", command: undefined, review_lens: "look" }),
    ]);
    const selection = selectChecks(
      routing({ checks: ["correctness", "test", "typecheck"] }),
      registry,
      FILES,
    );
    expect(selection.selected.map((s) => s.check.id)).toEqual(["correctness", "test", "typecheck"]);
  });

  it("selects nothing at all when there are no changed files", () => {
    const registry = buildRegistry([check()]);
    const selection = selectChecks(routing(), registry, []);
    expect(selection.selected).toEqual([]);
    expect(selection.unmatched).toEqual(["typecheck"]);
  });

  // ── declined coverage ──────────────────────────────────────────────────────
  //
  // `route()` drops disabled checks before selection is ever called, so they reach
  // no result and used to be indistinguishable from a change nothing covers. That
  // is the difference between exit 2 and exit 0, so it is read from the registry.

  it("names a disabled check that would have matched as declined coverage", () => {
    const registry = buildRegistry([check({ enabled: false })]);

    // Routing already dropped it, exactly as `route()` does in the gate.
    const selection = selectChecks(routing({ checks: [] }), registry, FILES);

    expect(selection.declined).toEqual(["typecheck"]);
  });

  it("does not call a disabled check declined when it matched no changed file", () => {
    // A retired check for another corner of the repo is not coverage anyone
    // declined for a change it would never have looked at. Reporting it would
    // make every unrelated run incomplete.
    const registry = buildRegistry([check({ enabled: false, include: ["docs/**/*.md"] })]);

    expect(selectChecks(routing({ checks: [] }), registry, FILES).declined).toEqual([]);
  });

  it("does not call a disabled check declined when it disclaims the tier", () => {
    const registry = buildRegistry([check({ enabled: false, tiers: ["light"] })]);

    expect(selectChecks(routing({ tier: "strict", checks: [] }), registry, FILES).declined).toEqual([]);
  });

  it("leaves declined empty when every check is enabled", () => {
    expect(selectChecks(routing(), buildRegistry([check()]), FILES).declined).toEqual([]);
  });
});
