/**
 * The built-in triage fallback and this repo's `.wst/triage.yaml` are one text.
 *
 * `rules.ts` says so in its own docstring — "`DEFAULT_RULES_YAML` is the exact
 * text shipped as `.wst/triage.yaml` … one source, so the built-in fallback and
 * the file on disk cannot drift apart" — and nothing enforced it. It drifted on
 * 2026-08-14: a reason was updated in the file and not in the constant, so a repo
 * with no `triage.yaml` of its own would have been told that a superseded
 * decision is why its decision record is `light`.
 *
 * Reads the real file rather than a fixture, for the same reason
 * `docs-fresh.test.ts` does: a fixture proves two strings compare, and what is
 * worth pinning is the pair that actually diverged. It lives under `test/`
 * because `src/core/` does no I/O, tests included.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFINITION_DIR } from "../src/core/paths.js";
import { DEFAULT_RULES_YAML } from "../src/core/triage/rules.js";

const ROOT = join(import.meta.dirname, "..");

/** Where the travelling half of the file stops and this repo's own rules begin. */
const MARKER = "# \u2500\u2500 BELOW HERE: rules of this repo only. They do NOT travel.";

describe("DEFAULT_RULES_YAML", () => {
  const onDisk = async (): Promise<string> =>
    readFile(join(ROOT, DEFINITION_DIR, "triage.yaml"), "utf-8");

  it("is byte-for-byte the part of this repo's triage.yaml that travels", async () => {
    // It used to be the WHOLE file, so a rule only this repo could want had
    // nowhere to live. The default is still one text; it is now a prefix.
    expect((await onDisk()).startsWith(DEFAULT_RULES_YAML)).toBe(true);
  });

  it("names the boundary in the file, so nobody has to infer where it is", async () => {
    expect(await onDisk()).toContain(MARKER);
  });

  it("keeps every local rule below the marker, where it cannot travel", async () => {
    const [travels, local] = (await onDisk()).split(MARKER);
    expect((travels ?? "").trimEnd()).toBe(DEFAULT_RULES_YAML.trimEnd());
    expect(local ?? "").toContain("plugin/**");
  });

  it("holds no path that exists only in Whetstone above the marker", async () => {
    expect(DEFAULT_RULES_YAML).not.toContain("plugin/**");
  });
});
