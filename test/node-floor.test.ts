/**
 * The Node floor, checked before the CLI is loaded.
 *
 * Seen in the field: a Node 16 ahead of nvm on the PATH made `wst` die on
 * `import { matchesGlob } from "node:path"`, and a husky hook read that as "wst is
 * old". A static import is resolved before any line runs, so the check only works
 * from an entry that imports nothing newer than itself.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { tooOldMessage } from "../src/node-floor.js";
import { tempDir } from "./tmp.js";

const exec = promisify(execFile);
const SRC = fileURLToPath(new URL("../src/", import.meta.url));

describe("tooOldMessage", () => {
  it("says nothing at the floor and above it", () => {
    expect(tooOldMessage("22.12.0", ">=22.12.0")).toBeNull();
    expect(tooOldMessage("22.12.1", ">=22.12.0")).toBeNull();
    expect(tooOldMessage("22.13.0", ">=22.12.0")).toBeNull();
    expect(tooOldMessage("24.0.0", ">=22.12.0")).toBeNull();
  });

  it("names both versions one below the floor, in one line", () => {
    const message = tooOldMessage("22.11.0", ">=22.12.0");

    expect(message).toContain("22.11.0");
    expect(message).toContain("22.12.0");
    expect(message?.split("\n")).toHaveLength(1);
  });

  it("compares numbers, not strings", () => {
    expect(tooOldMessage("9.99.99", ">=22.12.0")).not.toBeNull();
    expect(tooOldMessage("22.9.0", ">=22.12.0")).not.toBeNull();
    expect(tooOldMessage("100.0.0", ">=22.12.0")).toBeNull();
  });

  it("reads a pre-release of the floor as the floor", () => {
    expect(tooOldMessage("22.12.0-nightly2024", ">=22.12.0")).toBeNull();
  });

  it("does not refuse to start over a range it cannot read", () => {
    expect(tooOldMessage("16.0.0", "^22 || ^24")).toBeNull();
    expect(tooOldMessage("not a version", ">=22.12.0")).toBeNull();
  });
});

describe("the `wst` entry", () => {
  const run = async (version: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    const dir = await tempDir("wst-floor-");
    // After tsx, which reads the version itself to decide how to register.
    const preload = join(dir, "version.mjs");
    await writeFile(preload, `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });\n`, "utf-8");
    return exec(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", preload, join(SRC, "bin.ts"), ...args]).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
    );
  };

  it("exits 2 with one line on a Node below the floor, and runs nothing", async () => {
    const { code, stdout, stderr } = await run("16.20.2", "--version");

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr.trim().split("\n")).toHaveLength(1);
    expect(stderr).toContain("16.20.2");
  });

  it("hands over to the CLI on a Node that is new enough", async () => {
    const { code, stdout } = await run(process.versions.node, "--version");

    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("imports nothing statically that an old Node could choke on", async () => {
    const specifiers = async (file: string): Promise<string[]> =>
      [...(await readFile(join(SRC, file), "utf-8")).matchAll(/^import\s[^"']*["']([^"']+)["']/gm)].map((m) => m[1] ?? "");

    expect(await specifiers("bin.ts")).toEqual(["node:module", "./node-floor.js"]);
    expect(await specifiers("node-floor.ts")).toEqual([]);
  });

  it("is what the package's `wst` resolves to", async () => {
    const pkg = JSON.parse(await readFile(join(SRC, "../package.json"), "utf-8")) as { bin: { wst: string } };

    expect(pkg.bin.wst).toBe("dist/bin.js");
  });
});
