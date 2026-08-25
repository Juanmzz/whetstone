/**
 * What `wst.yaml` says after a first `init`.
 *
 * The shell reads `.wst/skills/` to learn what the target repo already has, and
 * caught ENOENT into `[]`. `activeSkills` treats `[]` as "read, and empty" —
 * deliberately, so a hand-written skill is not overwritten by the shipped list
 * — so every bootstrapped repo got a config declaring all eight skills
 * INACTIVE while the files sat on disk beside it. Nothing read the file back,
 * so nothing noticed until a screen rendered the count.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { runInit } from "../src/commands/init.js";
import { DEFINITION_DIR } from "../src/core/paths.js";
import { gitEnv } from "../src/shell/git.js";
import { tempDir } from "./tmp.js";

const exec = promisify(execFile);

async function bootstrapped(): Promise<string> {
  const dir = await tempDir("wst-config-");
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
  await writeFile(
    join(dir, "answers.json"),
    JSON.stringify({ purpose: "A demo repo", sourcePaths: ["src/**"] }),
    "utf-8",
  );
  await exec("git", ["add", "-A"], { cwd: dir, env });
  await exec("git", ["commit", "-qm", "first"], { cwd: dir, env });

  vi.spyOn(console, "log").mockImplementation(() => undefined);
  expect(await runInit({ answers: join(dir, "answers.json") }, dir)).toBe(0);
  vi.restoreAllMocks();
  return dir;
}

describe("the wst.yaml a first init writes", () => {
  it("declares every shipped skill ACTIVE", async () => {
    const dir = await bootstrapped();
    const text = await readFile(join(dir, DEFINITION_DIR, "wst.yaml"), "utf-8");
    const skills = (parseYaml(text) as { skills?: unknown }).skills;

    expect(Array.isArray(skills) ? skills.length : 0).toBe(8);
  });

  it("copied a file to disk for each one it declares", async () => {
    // The pairing is the point: a config that names a skill with no file, or a
    // file no config names, is a rule that silently does not apply.
    const dir = await bootstrapped();
    const text = await readFile(join(dir, DEFINITION_DIR, "wst.yaml"), "utf-8");
    const declared = (parseYaml(text) as { skills: string[] }).skills;

    for (const rel of declared) {
      await expect(readFile(join(dir, DEFINITION_DIR, rel), "utf-8")).resolves.toContain("id:");
    }
  });
});
