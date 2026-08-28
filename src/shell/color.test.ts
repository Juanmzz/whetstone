import { describe, expect, it } from "vitest";
import { colorDepth } from "./color.js";

const on = (env: Record<string, string | undefined>) => colorDepth(true, env);

describe("colorDepth", () => {
  it("takes 24-bit colour only where the terminal has said it has it", () => {
    expect(on({ COLORTERM: "truecolor" })).toBe("truecolor");
    expect(on({ COLORTERM: "24bit" })).toBe("truecolor");
  });

  it("assumes 256 from a terminal that never said, because many cannot", () => {
    // Apple's Terminal.app is the case that matters: it has colour, it has no
    // truecolor, and it sets no COLORTERM. Guessing 24-bit there posterises the
    // mark into whatever the nearest of its own 256 the terminal picks.
    expect(on({ TERM: "xterm-256color" })).toBe("ansi256");
    expect(on({})).toBe("ansi256");
  });

  it("gives up colour when asked to, at any value", () => {
    // no-color.org: presence is the signal, not the contents.
    expect(on({ NO_COLOR: "1", COLORTERM: "truecolor" })).toBe("none");
    expect(on({ NO_COLOR: "", COLORTERM: "truecolor" })).toBe("none");
  });

  it("gives up colour on a terminal that says it has none", () => {
    expect(on({ TERM: "dumb", COLORTERM: "truecolor" })).toBe("none");
  });

  it("gives up colour when the output is not a terminal at all", () => {
    expect(colorDepth(false, { COLORTERM: "truecolor" })).toBe("none");
  });
});
