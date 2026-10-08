import { describe, expect, it } from "vitest";
import { failureLines } from "./detail.js";

const ESC = String.fromCharCode(27);

describe("failureLines, stack frames", () => {
  it("keeps a stack frame in the project's own code", () => {
    const lines = failureLines("Error: boom\n    at total (/repo/src/price.ts:7:9)\n    at run (/repo/node_modules/x/i.js:1:1)");

    expect(lines).toEqual(["Error: boom", "    at total (/repo/src/price.ts:7:9)"]);
  });
});

describe("failureLines, what is not a frame", () => {
  it("keeps prose that starts with `at` and mentions node_modules", () => {
    const line = "at least one package in node_modules/foo is missing a peer";
    expect(failureLines(line)).toEqual([line]);
  });

  it("drops a dependency frame whose line opens an object", () => {
    expect(failureLines("E: x\n    at f (/r/node_modules/y/i.js:35:23) {\n  code: 1")).toEqual(["E: x", "  code: 1"]);
  });

  it("drops a vitest frame and a Windows one", () => {
    expect(failureLines(" ❯ node_modules/x/i.js:1:1\n    at f (C:\\r\\node_modules\\y\\i.js:3:4)\nkept")).toEqual(["kept"]);
  });
});

describe("failureLines, the caps", () => {
  const numbered = (n: number): string => Array.from({ length: n }, (_, i) => `line ${String(i + 1)}`).join("\n");

  it("returns everything when it fits", () => {
    expect(failureLines(numbered(40))).toHaveLength(40);
    expect(failureLines(numbered(40))[0]).toBe("line 1");
  });

  it("keeps the last 40 lines and says how many came before", () => {
    const lines = failureLines(numbered(41));

    expect(lines).toHaveLength(41);
    expect(lines[0]).toBe("… 1 earlier line not shown");
    expect(lines[1]).toBe("line 2");
    expect(lines.at(-1)).toBe("line 41");
  });

  it("counts only meaningful lines as omitted", () => {
    const lines = failureLines(`${numbered(50)}\n\n\n`);

    expect(lines[0]).toBe("… 10 earlier lines not shown");
  });

  it("cuts one enormous line rather than letting it be the whole report", () => {
    const [line] = failureLines(`HEAD${"x".repeat(9000)}`);

    expect(line?.startsWith("HEAD")).toBe(true);
    expect(line?.endsWith("…")).toBe(true);
    expect(line?.length).toBe(401);
  });

  it("leaves a line that is exactly at the limit alone", () => {
    expect(failureLines("x".repeat(400))).toEqual(["x".repeat(400)]);
  });

  it("caps the total size, dropping the oldest lines first", () => {
    const wide = Array.from({ length: 40 }, (_, i) => `${String(i + 1).padStart(2, "0")} ${"y".repeat(397)}`);

    const lines = failureLines(wide.join("\n"));

    expect(lines.slice(1).join("\n").length).toBeLessThanOrEqual(4000);
    expect(lines[0]).toMatch(/^… \d+ earlier lines not shown$/);
    expect(lines.at(-1)?.startsWith("40 ")).toBe(true);
  });

  it("always keeps the last line, however long", () => {
    const lines = failureLines(`${"a".repeat(5000)}\n${"b".repeat(5000)}`);

    expect(lines.at(-1)?.startsWith("b")).toBe(true);
  });
});

describe("failureLines, terminal noise", () => {
  it("keeps what a carriage return left on screen", () => {
    expect(failureLines("building 10%\rbuilding 90%\rbuild failed")).toEqual(["build failed"]);
  });

  it("keeps a line that ends in a carriage return, or two", () => {
    expect(failureLines("error: build failed\r")).toEqual(["error: build failed"]);
    expect(failureLines("FAIL a.test.ts\r\r\nAssertionError: x\r\r\n")).toEqual(["FAIL a.test.ts", "AssertionError: x"]);
  });

  it("strips a charset reset and other two-byte escapes, which `tput sgr0` emits", () => {
    expect(failureLines(`${ESC}[31mFAIL${ESC}(B${ESC}[m done${ESC}7${ESC}8`)).toEqual(["FAIL done"]);
  });

  it("does not let an unterminated OSC swallow the lines after it", () => {
    expect(failureLines(`${ESC}]0;title\nFAIL important\n\u0007after`)).toEqual(["]0;title", "FAIL important", "after"]);
  });

  it("reads CRLF output as lines", () => {
    expect(failureLines("one\r\ntwo\r\n")).toEqual(["one", "two"]);
  });

  it("strips an OSC hyperlink as well as a colour", () => {
    const link = `${ESC}]8;;file:///repo/a.ts${ESC}\\a.ts${ESC}]8;;${ESC}\\`;

    expect(failureLines(`${ESC}[31m${link} failed${ESC}[0m`)).toEqual(["a.ts failed"]);
  });

  it("returns nothing for output that says nothing", () => {
    expect(failureLines("")).toEqual([]);
    expect(failureLines(` \n\t\n${ESC}[0m\n`)).toEqual([]);
  });
});
