/**
 * The version the marketplace ships must be the version the package declares.
 *
 * They drifted once already, 0.5.0 against 0.5.0-alpha, and `wst status` would have
 * called the stale install current. The check that catches it runs against this repo
 * here, which is what keeps `main` honest; the rest exercises `--fix` on a scratch
 * copy, because the fix is the half a human would otherwise have to remember.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { tempDir } from "./tmp.js";

const exec = promisify(execFile);
const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "check-plugin-version.ts");
const PLUGIN = join("plugin", ".claude-plugin", "plugin.json");

const run = (dir: string, args: string[] = []): Promise<{ code: number; stderr: string }> =>
  exec("npx", ["tsx", SCRIPT, ...args], { cwd: dir })
    .then(({ stderr }) => ({ code: 0, stderr }))
    .catch((e: { code?: number; stderr?: string }) => ({ code: e.code ?? 1, stderr: e.stderr ?? "" }));

async function repoWith(pkg: string, plugin: string): Promise<string> {
  const dir = await tempDir("wst-plugin-version-");
  await mkdir(join(dir, "plugin", ".claude-plugin"), { recursive: true });
  await writeFile(join(dir, "package.json"), pkg, "utf-8");
  await writeFile(join(dir, PLUGIN), plugin, "utf-8");
  return dir;
}

const pluginIn = (dir: string): Promise<string> => readFile(join(dir, PLUGIN), "utf-8");

describe("check-plugin-version", () => {
  it("passes on this repository, so a drifted plugin cannot reach main", async () => {
    const { code } = await run(ROOT);

    expect(code).toBe(0);
  });

  it("fails on drift, touches nothing, and says where the fix is", async () => {
    const declared = '{\n  "name": "whetstone",\n  "version": "0.4.0"\n}\n';
    const dir = await repoWith('{\n  "version": "0.5.0"\n}\n', declared);

    const { code, stderr } = await run(dir);

    expect(code).toBe(1);
    expect(await pluginIn(dir)).toBe(declared);
    expect(stderr).toContain("npm run fix:plugin-version");
  });

  it("writes the package's version in, leaving the rest of the file as it was", async () => {
    const dir = await repoWith(
      '{\n  "version": "0.5.0"\n}\n',
      '{\n  "name": "whetstone",\n  "version": "0.4.0",\n  "author": { "name": "x" }\n}\n',
    );

    const { code } = await run(dir, ["--fix"]);

    expect(code).toBe(0);
    expect(await pluginIn(dir)).toBe(
      '{\n  "name": "whetstone",\n  "version": "0.5.0",\n  "author": { "name": "x" }\n}\n',
    );
  });

  it("refuses to invent a version field the plugin never declared", async () => {
    const declared = '{\n  "name": "whetstone"\n}\n';
    const dir = await repoWith('{\n  "version": "0.5.0"\n}\n', declared);

    const { code, stderr } = await run(dir, ["--fix"]);

    expect(code).toBe(1);
    expect(await pluginIn(dir)).toBe(declared);
    expect(stderr).toContain("does not declare");
  });
});
