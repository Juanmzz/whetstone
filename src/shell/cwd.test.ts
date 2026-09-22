import { describe, expect, it, vi } from "vitest";
import { requireCwd, resolveCwd } from "./cwd.js";

/**
 * Found in the field on 2026-09-15, in a published version, on a real session.
 *
 * `process.cwd()` was a DEFAULT PARAMETER on all eleven commands. A default is
 * evaluated before the function body, so no `try/catch` inside could reach it: when
 * macOS refused the directory (`EPERM: uv_cwd`), node died with an uncaught throw and
 * exited 1. The Stop hook treats 1 as "a check failed" and 2 as "could not run", so a
 * crash that ran no checks at all told an agent its correct code was broken, nine
 * times, until the harness overrode it.
 *
 * That is hard rule 3 broken in the outermost layer of the tool that declares it.
 */
describe("resolveCwd", () => {
  it("returns the working directory when it can be read", () => {
    expect(resolveCwd({ cwd: () => "/repo", env: {} })).toBe("/repo");
  });

  it("falls back to PWD first, because PWD follows `cd` and the harness root does not", () => {
    // Both reviewers, independently: `CLAUDE_PROJECT_DIR` is set on every command in a
    // Claude session and always names the SESSION root, so preferring it verified a
    // different repository than the one the caller was standing in and called it READY.
    // PWD tracks `cd`, so it is the one that still means "here".
    const cwd = (): string => {
      throw Object.assign(new Error("EPERM: uv_cwd"), { code: "EPERM" });
    };
    expect(
      resolveCwd({ cwd, env: { CLAUDE_PROJECT_DIR: "/session-root", PWD: "/here" } }),
    ).toBe("/here");
  });

  it("falls back to CLAUDE_PROJECT_DIR when PWD is not set", () => {
    const cwd = (): string => {
      throw new Error("EPERM");
    };
    expect(resolveCwd({ cwd, env: { CLAUDE_PROJECT_DIR: "/project" } })).toBe("/project");
  });

  it("names the fallback it used, so a wrong tree is never verified in silence", () => {
    const said: string[] = [];
    const cwd = (): string => {
      throw new Error("EPERM");
    };
    const where = resolveCwd({ cwd, env: { PWD: "/here" }, warn: (m) => said.push(m) });

    expect(where).toBe("/here");
    expect(said.join(" ")).toMatch(/could not read the working directory/i);
    expect(said.join(" ")).toContain("/here");
    expect(said.join(" ")).toContain("PWD");
  });

  it("says nothing when the real cwd answered", () => {
    const said: string[] = [];
    resolveCwd({ cwd: () => "/real", env: { PWD: "/here" }, warn: (m) => said.push(m) });
    expect(said).toEqual([]);
  });

  it("prefers the real cwd over both fallbacks", () => {
    expect(
      resolveCwd({ cwd: () => "/real", env: { CLAUDE_PROJECT_DIR: "/project", PWD: "/shell" } }),
    ).toBe("/real");
  });

  it("returns null when nothing can say where we are", () => {
    // Null rather than a guess. A command that verifies the wrong directory and
    // reports on it is worse than one that refuses and says why.
    const cwd = (): string => {
      throw new Error("EPERM");
    };
    expect(resolveCwd({ cwd, env: {} })).toBe(null);
  });

  it("ignores empty strings, which are not a directory", () => {
    const cwd = (): string => {
      throw new Error("EPERM");
    };
    expect(resolveCwd({ cwd, env: { CLAUDE_PROJECT_DIR: "", PWD: "  " } })).toBe(null);
  });

  it("does not throw, whatever the platform throws at it", () => {
    const cwd = (): string => {
      throw "a string, because not everything that is thrown is an Error";
    };
    expect(() => resolveCwd({ cwd, env: {} })).not.toThrow();
  });
});

describe("the process default", () => {
  it("reads the real process when given no source", () => {
    const spy = vi.spyOn(process, "cwd").mockReturnValue("/actual");
    try {
      expect(resolveCwd()).toBe("/actual");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("requireCwd", () => {
  it("returns the directory when one can be found", () => {
    expect(requireCwd({ cwd: () => "/repo", env: {} })).toBe("/repo");
  });

  it("throws a sentence a person can act on, not a stack about uv_cwd", () => {
    const cwd = (): string => {
      throw new Error("EPERM");
    };
    expect(() => requireCwd({ cwd, env: {} })).toThrow(/cannot read the working directory/);
    expect(() => requireCwd({ cwd, env: {} })).toThrow(/Nothing was verified/);
  });
});
