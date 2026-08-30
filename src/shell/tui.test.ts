import { describe, expect, it } from "vitest";
import { nameOf, paint } from "./tui.js";

const ESC = String.fromCharCode(27);

/** Just enough of a stream to capture what was written. */
function fake(): { out: NodeJS.WriteStream; written: () => string } {
  let buf = "";
  return {
    out: { write: (s: string) => void (buf += s) } as unknown as NodeJS.WriteStream,
    written: () => buf,
  };
}

describe("paint", () => {
  it("stops on its last line rather than one past it", () => {
    // A full-height screen was scrolling by one and losing its top row.
    const { out, written } = fake();

    paint(out, ["a", "b", "c"]);

    expect(written().endsWith("c")).toBe(true);
  });

  it("still separates the lines it was given", () => {
    const { out, written } = fake();

    paint(out, ["a", "b"]);

    expect(written()).toContain(`a${String.fromCharCode(10)}b`);
  });

  it("clears and hides the cursor before drawing", () => {
    const { out, written } = fake();

    paint(out, ["a"]);

    expect(written().startsWith(`${ESC}[2J${ESC}[H${ESC}[?25l`)).toBe(true);
  });
});

describe("nameOf", () => {
  const key = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra });

  it("names the DEL that a backspace key actually sends", () => {
    // macOS sends DEL (0x7f), not BS. `press` handles "backspace" and is tested,
    // but every one of those tests calls it directly and never comes through here,
    // which is how this survived two releases with a green suite.
    expect(nameOf("\u007f", key("backspace"))).toBe("backspace");
  });

  it("names the BS that other terminals send", () => {
    expect(nameOf("\b", key("backspace"))).toBe("backspace");
  });

  it("does not hand DEL back as a character to type", () => {
    // The bug in one line: 0x7f is greater than a space, so the printable guard
    // let it through and the interview typed a control character into the field.
    expect(nameOf("\u007f", key("backspace"))).not.toBe("\u007f");
  });

  it("still passes a letter through as itself", () => {
    expect(nameOf("a", key("a"))).toBe("a");
  });

  it("still names a key that arrives with no character", () => {
    expect(nameOf("", key("up"))).toBe("up");
  });

  it("names space rather than typing it, which is what the table is for", () => {
    expect(nameOf(" ", key("space"))).toBe("space");
  });

  it("names a control chord before it looks at the character", () => {
    expect(nameOf("\u000e", key("n", { ctrl: true }))).toBe("ctrl-n");
  });
});
