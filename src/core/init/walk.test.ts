import { describe, expect, it } from "vitest";
import { MAX_DEPTH, skipDir, walkDepth } from "./walk.js";

/**
 * Replays a path through `walkDepth` the way the walker does, and answers the
 * only question that matters: would `init` have SEEN this file?
 *
 * `manifests` names the directories that carry their own package manifest, repo
 * root included — that is the fact the walker reads off `readdir` and the fact
 * the depth budget turns on.
 */
function reachable(path: string, manifests: readonly string[] = [""]): boolean {
  const segments = path.split("/");
  const dirs = segments.slice(0, -1);
  let depth = 0;
  let rel = "";
  for (let i = 0; ; i++) {
    const here = walkDepth(depth, manifests.includes(rel) ? ["package.json"] : []);
    if (here === null) return false;
    if (i === dirs.length) return true;
    rel = rel === "" ? (dirs[i] ?? "") : `${rel}/${String(dirs[i])}`;
    depth = here + 1;
  }
}

describe("walkDepth — the bound a flat repo already had", () => {
  it("sees a file at the budget and stops one level past it", () => {
    expect(reachable("src/a/b/c/deep.ts")).toBe(true); // 4 directories deep
    expect(reachable("src/a/b/c/d/too-deep.ts")).toBe(false);
  });

  it("counts directories, not path segments — a root file is always reachable", () => {
    expect(reachable("package.json")).toBe(true);
    expect(walkDepth(0, [])).toBe(0);
    expect(walkDepth(MAX_DEPTH + 1, [])).toBeNull();
  });
});

describe("walkDepth — a monorepo is a repo of repos", () => {
  it("gives a nested package the same depth budget a flat repo gets", () => {
    // The file that made `init` write "no test files were found" into a repo
    // with 13 suites: five directories from the root, three from its own package.
    const manifests = ["", "apps/api"];
    expect(reachable("apps/api/src/llm/__tests__/retry.test.ts", manifests)).toBe(true);
    expect(reachable("apps/api/src/a/b/c/deep.ts", manifests)).toBe(true);
  });

  it("still bounds the walk INSIDE the nested package", () => {
    expect(reachable("apps/api/src/a/b/c/d/too-deep.ts", ["", "apps/api"])).toBe(false);
  });

  it("does not restart on a directory that carries no manifest", () => {
    expect(reachable("apps/api/src/llm/__tests__/retry.test.ts", [""])).toBe(false);
  });

  it("restarts again for a package nested inside a package", () => {
    expect(
      reachable("apps/api/vendored/lib/src/a/b/deep.ts", ["", "apps/api", "apps/api/vendored/lib"]),
    ).toBe(true);
  });
});

describe("skipDir", () => {
  it("refuses the directories that are somebody else's code or a build artefact", () => {
    for (const name of ["node_modules", ".git", "dist", "build", "coverage", "target"]) {
      expect(skipDir(name)).toBe(true);
    }
    expect(skipDir("src")).toBe(false);
    expect(skipDir("apps")).toBe(false);
  });
});
