/**
 * Every skill's version, changelog and frontmatter agree.
 *
 * `.wst/skills/**` is strict tier and no check covered it — the third place today where
 * the definition layer, which is what this tool exists to protect, was the part nothing
 * verified. A skill amended without a version bump propagates silently: `wst init`
 * copies these into every bootstrapped repo, and two repos on "v3" holding different
 * text is a rule that cannot be cited.
 *
 * Shape only, like `check-adrs.ts`. Whether a rule is GOOD is a retro's judgment; whether
 * a file claims a version its changelog does not record is a fact.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { DEFINITION_DIR } from "../src/core/paths.js";

const SKILLS = join(DEFINITION_DIR, "skills");
const CHECKS = join(DEFINITION_DIR, "checks");

interface Problem {
  readonly file: string;
  readonly why: string;
}

/** Below `changelogFrom` a file has never been amended, so it has nothing to log. */
function check(file: string, text: string, changelogFrom = 1): Problem[] {
  const out: Problem[] = [];
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (match === null) return [{ file, why: "has no YAML frontmatter delimited by `---`" }];

  let data: unknown;
  try {
    data = parse(match[1] ?? "");
  } catch {
    return [{ file, why: "has frontmatter that does not parse as YAML" }];
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [{ file, why: "has frontmatter that is not a mapping" }];
  }

  const version = (data as Record<string, unknown>)["version"];
  const body = match[2] ?? "";

  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    out.push({ file, why: `declares version ${JSON.stringify(version)}, expected a positive integer` });
    return out;
  }

  if (version < changelogFrom) return out;

  if (!body.includes("\n## Changelog")) {
    out.push({ file, why: "has no `## Changelog` section" });
    return out;
  }

  // The newest entry must be the version the frontmatter claims. This is the check
  // that catches an amendment landing without a bump, which is the failure that
  // propagates: `init` copies these files verbatim.
  const changelog = body.slice(body.indexOf("\n## Changelog"));
  const newest = /^-\s+v(\d+)\b/m.exec(changelog);
  if (newest === null) {
    out.push({ file, why: "has a `## Changelog` with no `- vN` entry" });
  } else if (Number(newest[1]) !== version) {
    out.push({
      file,
      why: `declares version ${version} but its newest changelog entry is v${newest[1]}`,
    });
  }

  return out;
}

async function readDir(dir: string): Promise<(readonly [string, string])[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  return Promise.all(names.map(async (n) => [n, await readFile(join(dir, n), "utf-8")] as const));
}

async function main(): Promise<void> {
  const skills = await readDir(SKILLS);
  if (skills.length === 0) {
    console.error(`${SKILLS} holds no skills: nothing was verified`);
    process.exit(1);
  }
  // Checks too (adr-0047), from v2 up: a v1 has never been amended.
  const checks = await readDir(CHECKS);

  const problems = [
    ...skills.flatMap(([n, t]) => check(`${SKILLS}/${n}`, t)),
    ...checks.flatMap(([n, t]) => check(`${CHECKS}/${n}`, t, 2)),
  ];

  if (problems.length > 0) {
    for (const p of problems) console.error(`${p.file} ${p.why}`);
    console.error(`\n${problems.length} problem(s) across ${skills.length + checks.length} file(s)`);
    process.exit(1);
  }

  console.error(
    `${skills.length} skills and ${checks.length} checks: versions, changelogs and frontmatter agree`,
  );
}

await main();
