/**
 * The constant that bounds the payload walk must be this package's real name.
 *
 * Renaming the package to publish it under a scope broke `init` silently in
 * every repo: the walk never found the package root, the skills were not
 * copied, and the only symptom was an exit code. A string that has to equal a
 * field in package.json should be checked against it.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/commands/init.js";

const ROOT = new URL("..", import.meta.url).pathname;

describe("PACKAGE_NAME", () => {
  it("is exactly what package.json declares", async () => {
    const pkg: unknown = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8"));
    expect(PACKAGE_NAME).toBe((pkg as { name: string }).name);
  });
});
