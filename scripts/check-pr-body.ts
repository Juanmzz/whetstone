/**
 * Whether this branch's pull request body can be read.
 *
 * The I/O around `core/pr/body.ts`. It reads the body from the pull request that
 * exists, and says so plainly when there is none: a branch nobody has opened a
 * pull request for is not a branch with a bad body, and reporting it as one is
 * the confusion hard rule 3 exists to prevent.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { MAX_LINES, readPrBody } from "../src/core/pr/body.js";

const run = promisify(execFile);

/** The body, and where it came from. Null when there is no pull request to read. */
async function bodyOf(): Promise<{ body: string; from: string } | null> {
  // CI hands it over in the event payload, which needs no auth and no network.
  const event = process.env["GITHUB_EVENT_PATH"];
  if (event !== undefined && event !== "") {
    try {
      const payload = JSON.parse(await readFile(event, "utf-8")) as {
        pull_request?: { body?: string | null; number?: number };
      };
      const pr = payload.pull_request;
      if (pr !== undefined) {
        return { body: pr.body ?? "", from: `PR #${String(pr.number ?? 0)} (event payload)` };
      }
    } catch {
      // A payload this cannot read is not a verdict on the body.
    }
  }

  try {
    const { stdout } = await run("gh", ["pr", "view", "--json", "body,number"], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const pr = JSON.parse(stdout) as { body?: string | null; number?: number };
    return { body: pr.body ?? "", from: `PR #${String(pr.number ?? 0)}` };
  } catch {
    return null;
  }
}

const found = await bodyOf();

if (found === null) {
  // Exit 0. Nothing was verified and the message says exactly that, rather than
  // passing quietly or failing a branch that has done nothing wrong.
  console.error("no pull request for this branch yet, so no body was read.");
  process.exit(0);
}

const read = readPrBody(found.body);

if (read.problems.length === 0) {
  console.error(`${found.from}: ${String(read.lines)} line(s), within the ${String(MAX_LINES)}-line ceiling`);
  process.exit(0);
}

console.error(`${found.from}: the body does not read.\n`);
for (const problem of read.problems) console.error(`  ${problem}`);
console.error(`\nThe template is .github/PULL_REQUEST_TEMPLATE.md. Delete any section you have`);
console.error(`nothing to say in; an empty heading claims there was nothing to weigh.`);
process.exit(1);
