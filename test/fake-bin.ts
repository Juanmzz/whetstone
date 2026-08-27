/**
 * A stand-in executable on `PATH`, for the adapters that spawn one.
 *
 * `src/shell/` is integration-tested rather than unit-tested (triage-rules.md), and
 * three of its adapters — `claude.ts`, `antigravity.ts`, `plugin.ts` — do their
 * whole job in the arguments and the working directory they hand to a child
 * process. None of that is a return value, so nothing about it can be asserted
 * from the outside without a child that reports what it received.
 *
 * PATH is used rather than an injected spawn function on purpose: the seam under
 * test is `execFile("claude", args, { cwd })` exactly as it ships, flag order and
 * all. A test that swapped the spawner would be asserting against a copy of the
 * call, which is how "the flag set is load-bearing" quietly stops being true.
 */

import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "./tmp.js";

/** What the child observed. The three facts the adapters are made of. */
export interface Invocation {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly stdin: string;
}

export interface Response {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exit?: number;
}

export interface FakeBin {
  /** Everything this binary was called with, oldest first. */
  invocations(): Promise<Invocation[]>;
  /**
   * What the next call prints and exits with. Pass `forSubcommand` to answer one
   * subcommand differently — `"--version"` and `"plugin"` are the two that matter.
   */
  respondWith(response: Response, forSubcommand?: string): Promise<void>;
  readonly dir: string;
}

/**
 * `fs.writeSync` rather than `process.stdout.write`: a pipe is asynchronous, so a
 * `process.exit` immediately after the write can truncate the envelope — which
 * would make every non-zero-exit case below look like a spawn failure and quietly
 * prove the opposite of what it is testing.
 *
 * Only `-p` waits for stdin. `--version` and `plugin list --json` are never
 * written to by their callers, and waiting for an end that never arrives would
 * hang the suite instead of failing it.
 */
const SCRIPT = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);

function respond(stdin) {
  fs.appendFileSync(
    path.join(__dirname, "invocations.jsonl"),
    JSON.stringify({ argv, cwd: process.cwd(), stdin }) + "\\n",
  );
  // One binary answers several questions — \`claude --version\`, \`claude plugin
  // list\`, \`claude -p\`. The subcommand picks the canned answer so a test that
  // needs two of them at once does not have to fake two binaries.
  const specific = path.join(__dirname, "response-" + String(argv[0]).replace(/[^a-z-]/gi, "") + ".json");
  const file = fs.existsSync(specific) ? specific : path.join(__dirname, "response.json");
  const plan = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (plan.stdout) fs.writeSync(1, plan.stdout);
  if (plan.stderr) fs.writeSync(2, plan.stderr);
  process.exit(plan.exit ?? 0);
}

if (argv[0] === "-p") {
  let stdin = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (c) => (stdin += c));
  process.stdin.on("end", () => respond(stdin));
} else {
  respond("");
}
`;

const originalPath = process.env["PATH"];

/** Puts `name` at the FRONT of PATH, so it shadows a real install if one exists. */
export async function installFakeBin(name: string, response: Response = {}): Promise<FakeBin> {
  const dir = await tempDir("wst-fake-bin-");
  const bin = join(dir, name);
  await writeFile(bin, SCRIPT, "utf-8");
  await chmod(bin, 0o755);
  await writeFile(join(dir, "response.json"), JSON.stringify(response), "utf-8");
  process.env["PATH"] = `${dir}:${originalPath ?? ""}`;

  return {
    dir,
    async respondWith(next, forSubcommand) {
      const name =
        forSubcommand === undefined
          ? "response.json"
          : `response-${forSubcommand.replace(/[^a-z-]/gi, "")}.json`;
      await writeFile(join(dir, name), JSON.stringify(next), "utf-8");
    },
    async invocations() {
      let text: string;
      try {
        text = await readFile(join(dir, "invocations.jsonl"), "utf-8");
      } catch {
        return []; // never called
      }
      return text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Invocation);
    },
  };
}

/**
 * A PATH holding NEITHER the real binary nor a fake, for the "it is not installed"
 * paths. Every adapter here has one and they are not decoration: `describePlugin`
 * answering "absent" instead of "unknown" would be status claiming a fact it never
 * verified.
 */
export function emptyPath(): void {
  process.env["PATH"] = "/nonexistent-wst-test-path";
}

export function restorePath(): void {
  if (originalPath === undefined) delete process.env["PATH"];
  else process.env["PATH"] = originalPath;
}
