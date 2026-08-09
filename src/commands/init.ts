/**
 * `wst init` — composition root. Gather the facts, call the core, show the plan,
 * write the files. Every decision lives in `src/core/init/`; if a judgement call
 * appears in this file it is in the wrong layer.
 *
 * ## The two-phase shape, and why
 *
 * `init` is agent-driven, not interactive. Run with no answers it PRINTS what it
 * inferred and the questions it cannot answer, then exits without writing
 * anything. The agent (or the human) answers those questions and runs it again
 * with `--answers`. That keeps the engine non-interactive and the questions
 * reviewable — a prompt loop in here would be untestable and would put the
 * interview's wording out of reach of the unit tests that check it.
 *
 * ## Never clobber
 *
 * ANY existing file the plan would write stops the command dead, not just `.sdd/`.
 * The guard used to cover `.sdd/` alone, which meant a repo that had never seen
 * Whetstone but did have a hand-written `AGENTS.md`, a `CLAUDE.md` and a populated
 * `.claude/settings.json` lost all three on the first command a new user ran. The
 * writer is `mkdir -p` + `writeFile` with no existence check of its own, so this is
 * the only thing standing between the plan and somebody's work.
 *
 * `core/init/collisions.ts` decides what a collision costs; this file only asks the
 * filesystem what is there. `--force` overwrites, still prints the list first, and
 * is not the default.
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { banner } from "../banner.js";
import { createGitAdapter } from "../shell/git.js";
import { collisionsIn, renderCollisions } from "../core/init/collisions.js";
import {
  NO_RISK,
  buildInterview,
  detectStack,
  planInit,
  type InitPlan,
  type InterviewAnswers,
  type PackageJson,
  type RepoFacts,
} from "../core/init/index.js";

const run = promisify(execFile);

export interface InitOptions {
  /** Path to a JSON file holding `InterviewAnswers`. */
  readonly answers?: string;
  /** Shorthand for a one-line purpose when no answers file is used. */
  readonly purpose?: string;
  /** Comma-separated risk flags: money,personalData,productionData,authn,safetyCritical */
  readonly risk?: string;
  /** Repeatable `glob:reason`. */
  readonly strict?: readonly string[];
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly json?: boolean;
  readonly agentLens?: boolean;
  readonly codeTier?: boolean;
}

// ── gathering facts ──────────────────────────────────────────────────────────

/** Directories never worth walking: huge, generated, or somebody else's code. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
]);

/** Deep enough to see `src/**​/*.ts` and `.github/workflows/`, shallow enough to be instant. */
const MAX_DEPTH = 4;
const MAX_FILES = 4000;

async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name), childRel, depth + 1);
      } else {
        found.push(childRel);
      }
    }
  }

  await walk(root, "", 0);
  return found;
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  try {
    // A malformed package.json is indistinguishable from an absent one for our
    // purposes: neither can be trusted to name a command that exists.
    return JSON.parse(await readFile(join(root, "package.json"), "utf-8")) as PackageJson;
  } catch {
    return null;
  }
}

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function gatherFacts(root: string): Promise<RepoFacts> {
  const [files, packageJson, log, shortlog] = await Promise.all([
    listFiles(root),
    readPackageJson(root),
    git(["log", "-n", "40", "--pretty=format:%s"], root),
    git(["shortlog", "-sne", "HEAD"], root),
  ]);

  const contributors =
    shortlog === null ? null : shortlog.split("\n").filter((l) => l.trim().length > 0).length;

  return {
    repoName: root.split("/").filter(Boolean).pop() ?? "project",
    files,
    packageJson,
    commitSubjects: log === null ? [] : log.split("\n").filter((s) => s.trim().length > 0),
    contributors: contributors === 0 ? null : contributors,
  };
}

// ── answers ──────────────────────────────────────────────────────────────────

/**
 * Validated rather than cast. The answers file is hand-written (usually by an
 * agent), and a typo'd key silently becoming `undefined` produces a constitution
 * with a hole in it — the exact outcome `validateAnswers` exists to prevent, one
 * layer too late to catch it.
 */
const AnswersSchema = z.strictObject({
  purpose: z.string(),
  risk: z
    .strictObject({
      money: z.boolean().default(false),
      personalData: z.boolean().default(false),
      productionData: z.boolean().default(false),
      authn: z.boolean().default(false),
      safetyCritical: z.boolean().default(false),
      note: z.string().nullable().default(null),
    })
    .default(NO_RISK),
  strictPaths: z
    .array(z.strictObject({ glob: z.string(), reason: z.string() }))
    .default([]),
  conventions: z.array(z.string()).default([]),
});

const RISK_KEYS = ["money", "personalData", "productionData", "authn", "safetyCritical"] as const;

function answersFromFlags(opts: InitOptions): InterviewAnswers | null {
  if (opts.purpose === undefined) return null;

  const flags = (opts.risk ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const unknown = flags.filter((f) => !(RISK_KEYS as readonly string[]).includes(f));
  if (unknown.length > 0) {
    throw new Error(
      `unknown --risk flag(s): ${unknown.join(", ")}. Expected any of: ${RISK_KEYS.join(", ")}`,
    );
  }

  const strictPaths = (opts.strict ?? []).map((entry) => {
    const idx = entry.indexOf(":");
    if (idx === -1) {
      throw new Error(
        `--strict "${entry}" has no reason. Use "<glob>:<why it earns full TDD>" — a rule ` +
          `that cannot say why it exists cannot be reviewed, and therefore cannot be retired.`,
      );
    }
    return { glob: entry.slice(0, idx).trim(), reason: entry.slice(idx + 1).trim() };
  });

  return {
    purpose: opts.purpose,
    risk: {
      ...NO_RISK,
      ...Object.fromEntries(RISK_KEYS.map((k) => [k, flags.includes(k)])),
    },
    strictPaths,
    conventions: [],
  };
}

async function loadAnswers(opts: InitOptions, cwd: string): Promise<InterviewAnswers | null> {
  if (opts.answers !== undefined) {
    const raw = await readFile(resolve(cwd, opts.answers), "utf-8");
    return AnswersSchema.parse(JSON.parse(raw));
  }
  return answersFromFlags(opts);
}

// ── output ───────────────────────────────────────────────────────────────────

function printDetection(stack: ReturnType<typeof detectStack>): void {
  console.log(`\ndetected (${stack.greenness})`);
  if (stack.evidence.length === 0) {
    console.log("  nothing — no code, no manifest, no history");
    return;
  }
  for (const line of stack.evidence) console.log(`  ${line}`);
}

function printQuestions(stack: ReturnType<typeof detectStack>): void {
  const questions = buildInterview(stack);
  console.log(`\n${questions.length} question(s) the repo could not answer:\n`);
  for (const [i, q] of questions.entries()) {
    console.log(`  ${i + 1}. [${q.id}] ${q.prompt}`);
    console.log(`     why: ${q.why}`);
    for (const opt of q.options) console.log(`       - ${opt.value}: ${opt.label}`);
    if (q.defaultAnswer !== null) console.log(`     default: ${q.defaultAnswer}`);
    console.log("");
  }
  console.log("Answer them, then re-run with either:");
  console.log("  wst init --answers <file.json>");
  console.log('  wst init --purpose "..." --risk money,authn --strict "src/billing/**:moves money"');
  console.log("\nNothing was written.");
}

function printPlan(plan: InitPlan, root: string): void {
  console.log(`\nplan for ${root}\n`);
  for (const file of plan.files) {
    const bytes = Buffer.byteLength(file.contents, "utf-8");
    const mode = file.executable === true ? " (executable)" : "";
    console.log(`  + ${file.path.padEnd(42)} ${String(bytes).padStart(6)} bytes${mode}`);
  }
  for (const copy of plan.copies) console.log(`  + ${copy.to.padEnd(42)}    copied verbatim`);

  if (plan.notes.length > 0) {
    console.log("\nnotes");
    for (const note of plan.notes) console.log(`  · ${note}`);
  }
}

// ── writing ──────────────────────────────────────────────────────────────────

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whetstone's own payload directory, holding the skills copied verbatim into the
 * target. Located by walking up from this module rather than by a hard-coded
 * relative path, so it works the same from `src/` under tsx and from `dist/`
 * after a build.
 *
 * IT MUST STOP AT WHETSTONE'S OWN PACKAGE ROOT. Installed as a dependency the
 * module sits at `<target>/node_modules/whetstone/dist/commands/`, and an unbounded
 * walk escapes the package and finds `<target>/.sdd/skills` — the TARGET's skills.
 * `init` would then copy a project's own skills back onto itself and report success,
 * which looks exactly like a correct bootstrap. So the walk is bounded by the
 * package.json that declares this package, and never crosses a node_modules boundary.
 */
const PACKAGE_NAME = "whetstone";

async function findPayloadRoot(): Promise<string | null> {
  let dir = import.meta.dirname;
  for (;;) {
    // Reached this package's own root? Answer from here, and never look higher.
    try {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8")) as {
        name?: string;
      };
      if (pkg.name === PACKAGE_NAME) {
        return (await exists(join(dir, ".sdd", "skills"))) ? join(dir, ".sdd") : null;
      }
    } catch {
      /* no package.json here — keep walking */
    }

    const parent = dirname(dir);
    // Never step out of the installed package into the consuming project.
    if (parent === dir || basename(dir) === "node_modules") return null;
    dir = parent;
  }
}

/**
 * Which of the plan's target paths are already on disk.
 *
 * The one place `init` touches the filesystem to answer a question rather than to
 * write. Stat-per-path rather than a directory walk: the plan is ~30 paths, and a
 * walk would have to reason about ignore rules to be equivalent.
 */
async function existingOf(plan: InitPlan, root: string): Promise<string[]> {
  const paths = [...plan.files.map((f) => f.path), ...plan.copies.map((c) => c.to)];
  const found = await Promise.all(
    paths.map(async (path) => ((await exists(join(root, path))) ? path : null)),
  );
  return found.filter((path): path is string => path !== null);
}

async function writePlan(plan: InitPlan, root: string, payloadRoot: string | null): Promise<void> {
  for (const file of plan.files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents, "utf-8");
    // A hook without the executable bit is a hook that silently never runs, and
    // "the guard is installed but does nothing" is the worst state to be in.
    // `chmod`, not writeFile's `mode` option: that option only applies when the
    // file is CREATED, so on the second write it is silently ignored — which is
    // exactly how this shipped broken the first time.
    if (file.executable === true) await chmod(target, 0o755);
  }

  if (payloadRoot === null) return;
  for (const copy of plan.copies) {
    const source = join(payloadRoot, copy.from);
    const target = join(root, copy.to);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(source, "utf-8"), "utf-8");
  }
}

// ── the command ──────────────────────────────────────────────────────────────

export async function runInit(opts: InitOptions, cwd: string = process.cwd()): Promise<number> {
  const root = (await createGitAdapter(cwd).repoRoot()) ?? cwd;

  const facts = await gatherFacts(root);
  const stack = detectStack(facts);

  let answers: InterviewAnswers | null;
  try {
    answers = await loadAnswers(opts, cwd);
  } catch (cause) {
    console.error(`could not read the answers\n  ${(cause as Error).message}`);
    return 1;
  }

  if (answers === null) {
    console.log(`${banner()}\n\ninit — ${root}`);
    printDetection(stack);
    printQuestions(stack);
    return 0;
  }

  let plan: InitPlan;
  try {
    plan = planInit({
      facts,
      answers,
      clock: { now: () => new Date() },
      options: {
        ...(opts.agentLens !== undefined ? { seedAgentLens: opts.agentLens } : {}),
        ...(opts.codeTier !== undefined ? { emitCodeTier: opts.codeTier } : {}),
      },
    });
  } catch (cause) {
    console.error(`${(cause as Error).message}`);
    return 1;
  }

  if (opts.json === true) {
    console.log(JSON.stringify({ stack: plan.stack, files: plan.files, copies: plan.copies, notes: plan.notes }, null, 2));
    return 0;
  }

  console.log(`${banner()}\n\ninit — ${root}`);
  printDetection(plan.stack);
  printPlan(plan, root);

  // Checked AFTER the questions phase and the plan on purpose: both are read-only,
  // and printing what init WOULD ask or write stays useful in a repo it refuses to
  // touch. Checked BEFORE the writer because the writer has no existence check of
  // its own — it is `mkdir -p` + `writeFile`, and by the time it runs the previous
  // contents are already gone.
  const collisions = collisionsIn(plan, await existingOf(plan, root));

  if (collisions.length > 0) {
    if (opts.force !== true) {
      console.error(`\n${renderCollisions(collisions)}`);
      return 1;
    }
    // --force still SAYS what it is about to destroy. A destructive flag that
    // works silently teaches people to pass it by reflex.
    console.log(`\n--force: overwriting ${String(collisions.length)} existing file(s):`);
    for (const collision of collisions) console.log(`  ${collision.path}`);
  }

  if (opts.dryRun === true) {
    console.log("\n--dry-run: nothing written.");
    return 0;
  }

  const payloadRoot = await findPayloadRoot();
  if (payloadRoot === null) {
    console.error(
      "\ncould not locate Whetstone's own skills directory, so the skills were NOT copied.\n" +
        "  Everything else was written. Copy `.sdd/skills/` across by hand, or re-run from a\n" +
        "  checkout rather than a published package.",
    );
  }

  try {
    await writePlan(plan, root, payloadRoot);
  } catch (cause) {
    console.error(`\nwrite failed: ${(cause as Error).message}`);
    return 1;
  }

  const written = plan.files.length + (payloadRoot === null ? 0 : plan.copies.length);
  console.log(`\nwrote ${written} files. Review them, then commit:`);
  console.log("  git add .sdd .claude AGENTS.md CLAUDE.md");
  console.log('  git commit -m "chore: bootstrap the agent workflow"');
  return payloadRoot === null ? 1 : 0;
}
