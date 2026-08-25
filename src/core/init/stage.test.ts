import { describe, expect, it } from "vitest";
import { stagePaths } from "./stage.js";

describe("stagePaths — the commit line names what init wrote", () => {
  it("collapses every file under a directory into that directory", () => {
    expect(
      stagePaths({
        files: [{ path: ".wst/wst.yaml" }, { path: ".wst/memory/decisions.md" }],
        copies: [{ to: ".wst/skills/lazy.md" }],
      }),
    ).toEqual([".wst"]);
  });

  it("keeps a root file as itself", () => {
    expect(stagePaths({ files: [{ path: "AGENTS.md" }], copies: [] })).toEqual(["AGENTS.md"]);
  });

  it("names GEMINI.md when the plan writes it", () => {
    // The line was hardcoded and predated the Gemini pointer, so a stranger's
    // first commit silently left the file init had just written untracked.
    const paths = stagePaths({
      files: [{ path: "AGENTS.md" }, { path: "CLAUDE.md" }, { path: "GEMINI.md" }],
      copies: [],
    });
    expect(paths).toContain("GEMINI.md");
  });

  it("omits a path the plan does not write", () => {
    const paths = stagePaths({ files: [{ path: ".wst/wst.yaml" }], copies: [] });
    expect(paths).not.toContain(".claude");
  });

  it("puts the definition directory first, then the rest alphabetically", () => {
    expect(
      stagePaths({
        files: [{ path: "GEMINI.md" }, { path: "AGENTS.md" }, { path: ".wst/wst.yaml" }],
        copies: [],
      }),
    ).toEqual([".wst", "AGENTS.md", "GEMINI.md"]);
  });

  it("returns nothing for a plan that writes nothing", () => {
    expect(stagePaths({ files: [], copies: [] })).toEqual([]);
  });
});
