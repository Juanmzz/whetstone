import { describe, expect, it } from "vitest";
import { DEFINITION_DIR, LEGACY_DEFINITION_DIR, legacyDirectoryMessage } from "./paths.js";

describe("the definition directory (ADR-0012)", () => {
  it("is `.wst`, not a generic industry term", () => {
    expect(DEFINITION_DIR).toBe(".wst");
  });

  it("remembers the name it used to claim", () => {
    expect(LEGACY_DEFINITION_DIR).toBe(".sdd");
  });
});

/**
 * ADR-0012 chose a CLEAN migration with no dual path: `wst` reads `.wst/` and
 * nothing else, because two possible directories means five commands must decide
 * which wins and a repo holding both has no source of truth.
 *
 * The cost of that is a repo installed before the rename failing blankly, which
 * is why this message is part of the decision rather than a nicety. It is
 * DIAGNOSIS, not compatibility — nothing is loaded from the old directory, and
 * the message has to say so, or the next reader assumes a fallback exists.
 */
describe("the migration diagnostic", () => {
  const message = legacyDirectoryMessage("/repo");

  it("names the old directory, which is the fact the user is missing", () => {
    expect(message).toContain(LEGACY_DEFINITION_DIR);
  });

  it("names the new one, so the rename is not a guess", () => {
    expect(message).toContain(DEFINITION_DIR);
  });

  it("hands over the exact command, not a description of one", () => {
    expect(message).toContain(`git mv ${LEGACY_DEFINITION_DIR} ${DEFINITION_DIR}`);
  });

  it("locates it, so the message is actionable from anywhere", () => {
    expect(message).toContain("/repo");
  });

  /**
   * Without this the message reads as a deprecation warning, and a reader who
   * believes the old directory is still consulted will leave it in place.
   */
  it("says the old directory is not read", () => {
    expect(message.toLowerCase()).toMatch(/nothing is (read|loaded) from/);
  });
});
