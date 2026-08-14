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

describe("DEFAULT_RULES_YAML", () => {
  it("is byte-for-byte this repo's triage.yaml", async () => {
    const onDisk = await readFile(join(ROOT, DEFINITION_DIR, "triage.yaml"), "utf-8");

    expect(DEFAULT_RULES_YAML).toBe(onDisk);
  });
});
