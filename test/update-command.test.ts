/**
 * `wst update` end to end: bootstrap a repo, change it, see what it says.
 *
 * Driven through `runInit` rather than a fixture, because the thing under test is
 * whether the base `init` records still describes the repo `init` wrote. A
 * hand-built base would prove the classifier and nothing else.
 */

import { execFile } from "node:child_process";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init.js";
import { runUpdate } from "../src/commands/update.js";
import { DEFINITION_DIR } from "../src/core/paths.js";
import { gitEnv } from "../src/shell/git.js";
import { tempDir } from "./tmp.js";

const exec = promisify(execFile);

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
});
afterEach(() => void vi.restoreAllMocks());

const stdout = (): string => out.join("\n");
const stderr = (): string => err.join("\n");

async function bootstrapped(): Promise<string> {
  const dir = await tempDir("wst-update-");
  const env = {
    ...gitEnv(),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t.invalid",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t.invalid",
  };
  await exec("git", ["init", "-q"], { cwd: dir, env });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "demo", scripts: { test: "echo ok" } }),
    "utf-8",
  );
  await writeFile(join(dir, "answers.json"), JSON.stringify({
    purpose: "A demo repo",
    sourcePaths: ["src/**"],
  }), "utf-8");
  await exec("git", ["add", "-A"], { cwd: dir, env });
  await exec("git", ["commit", "-qm", "first"], { cwd: dir, env });

  expect(await runInit({ answers: join(dir, "answers.json") }, dir)).toBe(0);
  out = [];
  return dir;
}

describe("wst update", () => {
  it("refuses to guess when no base was recorded", async () => {
    const dir = await tempDir("wst-nobase-");

    expect(await runUpdate({}, dir)).toBe(2);
    expect(stderr()).toMatch(/no .*base\.json/);
  });

  it("reports a freshly bootstrapped repo as entirely untouched", async () => {
    const dir = await bootstrapped();

    expect(await runUpdate({}, dir)).toBe(0);
    expect(stdout()).toMatch(/file\(s\) are as init left them/);
    expect(stdout()).not.toContain("drifted");
  });

  it("calls a hand-edited file drifted, and says regenerating would lose it", async () => {
    const dir = await bootstrapped();
    await appendFile(join(dir, DEFINITION_DIR, "triage.yaml"), "\nA line I added.\n", "utf-8");

    await runUpdate({}, dir);

    expect(stdout()).toContain("drifted");
    expect(stdout()).toContain(`${DEFINITION_DIR}/triage.yaml`);
    expect(stdout()).toContain("regenerating would lose that");
  });

  it("reports a deleted file rather than quietly leaving it out", async () => {
    const dir = await bootstrapped();
    await rm(join(dir, DEFINITION_DIR, "checks", "test.md"));

    await runUpdate({}, dir);

    expect(stdout()).toContain("missing");
    expect(stdout()).toContain("checks/test.md");
  });

  it("writes nothing, which is the whole contract until a merge is earned", async () => {
    const dir = await bootstrapped();
    const before = await readFile(join(dir, DEFINITION_DIR, "triage.yaml"), "utf-8");
    await appendFile(join(dir, DEFINITION_DIR, "triage.yaml"), "\nMine.\n", "utf-8");

    await runUpdate({}, dir);

    const after = await readFile(join(dir, DEFINITION_DIR, "triage.yaml"), "utf-8");
    expect(after).toBe(`${before}\nMine.\n`);
  });

  it("records a base that covers every file init wrote", async () => {
    const dir = await bootstrapped();
    const base = JSON.parse(
      await readFile(join(dir, DEFINITION_DIR, "base.json"), "utf-8"),
    ) as { files: Record<string, string>; answers: { purpose: string } };

    // A new installation is four files, not the twenty-eight it used to be.
    expect(Object.keys(base.files).length).toBeGreaterThan(3);
    // The answers travel with it, which is what lets update re-plan rather than diff blind.
    expect(base.answers.purpose).toBe("A demo repo");
  });
});
