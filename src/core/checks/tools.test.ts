import { describe, expect, it } from "vitest";
import { binariesFor } from "./tools.js";

const SCRIPTS = {
  test: "vitest run",
  "test:e2e": "playwright test",
  ci: "npm run test:e2e",
  loop: "npm run loop",
  spread: "npm run test --workspaces --if-present",
};

describe("binariesFor", () => {
  it("takes the first word of a plain command", () => {
    expect(binariesFor("tsc --noEmit", {})).toEqual(["tsc"]);
  });

  it("follows `npm run` into the script it names", () => {
    // The case this exists for: sift declares `npm run test:e2e`, npm is
    // installed, and the thing that is missing is `playwright`, two hops down.
    expect(binariesFor("npm run test:e2e", SCRIPTS)).toEqual(["playwright"]);
  });

  it("follows a chain of scripts", () => {
    expect(binariesFor("npm run ci", SCRIPTS)).toEqual(["playwright"]);
  });

  it("stops on a script that calls itself rather than looping forever", () => {
    expect(binariesFor("npm run loop", SCRIPTS)).toEqual([]);
  });

  it("reports npm itself when the script does not exist", () => {
    // A missing script is a different failure, and one npm will name. Claiming
    // to know the binary here would be inventing it.
    expect(binariesFor("npm run nope", SCRIPTS)).toEqual(["npm"]);
  });

  it("names every binary a chained command needs", () => {
    expect(binariesFor("tsc --noEmit && eslint .", {})).toEqual(["tsc", "eslint"]);
    expect(binariesFor("prettier --check . || exit 1", {})).toEqual(["prettier"]);
    expect(binariesFor("vitest run; tsc", {})).toEqual(["vitest", "tsc"]);
  });

  it("ignores a shell builtin, which is never a missing tool", () => {
    expect(binariesFor("true", {})).toEqual([]);
    expect(binariesFor("echo ok && cd src", {})).toEqual([]);
  });

  it("ignores an env prefix and reports the command it wraps", () => {
    expect(binariesFor("NODE_ENV=test vitest run", {})).toEqual(["vitest"]);
  });

  it("says nothing about a command it cannot read rather than guessing", () => {
    expect(binariesFor("", {})).toEqual([]);
    expect(binariesFor("   ", {})).toEqual([]);
  });

  it("does not report the same binary twice", () => {
    expect(binariesFor("tsc -p a && tsc -p b", {})).toEqual(["tsc"]);
  });
});
