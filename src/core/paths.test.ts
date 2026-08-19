import { describe, expect, it } from "vitest";
import { DEFINITION_DIR } from "./paths.js";

describe("the definition directory (ADR-0012)", () => {
  it("is `.wst`, not a generic industry term", () => {
    expect(DEFINITION_DIR).toBe(".wst");
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
