/**
 * `plugin/.claude-plugin/plugin.json` must declare the version `package.json` does.
 *
 * The copy cannot be deleted the way `src/cli.ts`'s was. cli.ts reads package.json at
 * runtime because the process that needs the number can open the file; Claude Code
 * reads plugin.json out of a plain `git clone` of this repo, never runs our build and
 * never sees package.json, so the literal has to be committed. What it costs when the
 * two part company: the install cache is keyed by version
 * (`~/.claude/plugins/cache/whetstone/whetstone/0.5.0`), so a number that did not move
 * makes a new payload indistinguishable from the one already installed.
 *
 * So package.json holds the one authored number and `--fix` derives the other.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PACKAGE = "package.json";
const PLUGIN = join("plugin", ".claude-plugin", "plugin.json");

/** Matches the field in place: rewriting the digits keeps the file's own formatting. */
const FIELD = /("version"\s*:\s*")([^"]*)(")/;

const versionOf = async (path: string): Promise<string | null> => {
  const parsed: unknown = JSON.parse(await readFile(path, "utf-8"));
  const version = (parsed as Record<string, unknown>)["version"];
  return typeof version === "string" ? version : null;
};

async function main(): Promise<void> {
  const fix = process.argv.includes("--fix");

  const authored = await versionOf(PACKAGE);
  if (authored === null) {
    console.error(`${PACKAGE} declares no version.`);
    process.exit(1);
  }

  const declared = await versionOf(PLUGIN);
  if (declared === authored) {
    console.error(`${PLUGIN} declares ${authored}, the version ${PACKAGE} does.`);
    return;
  }

  console.error(
    declared === null
      ? `${PLUGIN} declares no version: ${PACKAGE} says ${authored}.`
      : `${PLUGIN} declares ${declared}: ${PACKAGE} says ${authored}.`,
  );

  // A file with no version field has nowhere to write one that would land in the
  // right place, so `--fix` reports it and still fails rather than guessing.
  if (fix && declared !== null) {
    const source = await readFile(PLUGIN, "utf-8");
    await writeFile(PLUGIN, source.replace(FIELD, `$1${authored}$3`), "utf-8");
    console.error(`\nfixed: ${PLUGIN} now declares ${authored}`);
    return;
  }

  console.error(
    fix
      ? `\nCannot fix a version the file does not declare. Add the field, then re-run.`
      : `\nRun \`npm run fix:plugin-version\`. Bump ${PACKAGE}, never ${PLUGIN}.`,
  );
  process.exit(1);
}

await main();
