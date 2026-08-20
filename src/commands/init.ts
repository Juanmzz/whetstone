/**
 * `wst init` — composition root. Gather the facts, call the core, show the plan,
 * write the files. Every decision lives in `src/core/init/`; if a judgement call
 * appears in this file it is in the wrong layer.
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { banner } from "../banner.js";
import { createGitAdapter, gitEnv } from "../shell/git.js";
import { DEFINITION_DIR } from "../core/paths.js";
import { collisionsIn, renderCollisions } from "../core/init/collisions.js";
import {
  ProposalSchema,
  buildProposalPrompt,
  proposalToAnswers,
  renderProposal,
} from "../core/init/propose.js";
// `init` runs BEFORE a definition layer exists, so there is no `agent:` key to
// read. It uses the default adapter, which is the only one that ships.
import { judgeFor } from "../shell/judge.js";
import { DEFAULT_CONFIG } from "../core/config/schema.js";
import { exists } from "../shell/fs.js";
import {
  MAX_FILES,
  NO_RISK,
  ROOT_GITIGNORE_ENTRIES,
  buildInterview,
  detectStack,
  planInit,
  renderRootGitignoreStanza,
  skillCopies,
  skipDir,
  walkDepth,
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
  /** Repeatable glob naming where the project's code lives. */
  readonly source?: readonly string[];
  /** Repeatable `glob:reason`. */
  readonly strict?: readonly string[];
  /** What the project is built with, verbatim into the constitution. */
  readonly stack?: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly json?: boolean;
  /** Draft the answers with the judge instead of asking the human to type them. */
  readonly propose?: boolean;
  /** Where --propose writes its draft. */
  readonly out?: string;
  readonly agentLens?: boolean;
  /**
   * Write `.wst/` and nothing else.
   *
   * For a repo that already has a harness. One such repo had its own `CLAUDE.md`, its own
   * `AGENTS.md` and a plugin that owns `.claude/`; the collision guard stops `init`
   * destroying them, but stopping is not the same as coexisting. This is the mode
   * that lets Whetstone be the verifier for a workspace somebody else runs.
   */
  readonly definitionsOnly?: boolean;
}

// ── gathering facts ──────────────────────────────────────────────────────────

/**
 * The walk. How deep it goes is `core/init/walk.ts`'s decision, not this file's —
 * the budget restarts at every package manifest, so a monorepo's packages are each
 * read as deeply as a flat repo is.
 *
 * The directory is READ before its depth is judged, because the manifest that
 * restarts the budget is one of the entries. That costs one `readdir` at each
 * boundary and buys the walker its only view of where a package begins.
 */
async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (found.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const here = walkDepth(
      depth,
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    );
    if (here === null) return;

    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (skipDir(entry.name)) continue;
        await walk(join(dir, entry.name), childRel, here + 1);
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
    const { stdout } = await run("git", args, { cwd, env: gitEnv(), maxBuffer: 8 * 1024 * 1024 });
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
  // Defaulted, not required: an answers file written before these two questions
  // existed still parses, and lands on the same blank a skipped question does.
  sourcePaths: z.array(z.string()).default([]),
  strictPaths: z
    .array(z.strictObject({ glob: z.string(), reason: z.string() }))
    .default([]),
  stack: z.string().nullable().default(null),
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
    sourcePaths: opts.source ?? [],
    strictPaths,
    stack: opts.stack ?? null,
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
  console.log(`\nread from this repo`);
  if (stack.evidence.length === 0) {
    console.log("  nothing — no manifest, no lockfile, no tests");
    return;
  }
  for (const line of stack.evidence) console.log(`  ${line}`);
}

function printQuestions(): void {
  const questions = buildInterview();
  console.log(`\n${questions.length} question(s) this repo does not declare an answer to:\n`);
  for (const [i, q] of questions.entries()) {
    console.log(`  ${i + 1}. [${q.id}] ${q.prompt}`);
    console.log(`     why: ${q.why}`);
    for (const opt of q.options) console.log(`       - ${opt.value}: ${opt.label}`);
    if (q.defaultAnswer !== null) console.log(`     default: ${q.defaultAnswer}`);
    console.log("");
  }
  console.log("Answer them, then re-run with either:");
  console.log("  wst init --answers <file.json>");
  console.log(
    '  wst init --purpose "..." --risk money,authn --source "src/**" \\\n' +
      '           --strict "src/billing/**:moves money" --stack "TypeScript on Node 24"',
  );
  console.log("\nNothing was written.");
}

function printPlan(plan: InitPlan, root: string): void {
  console.log(`\nplan for ${root}\n`);
  for (const file of plan.files) {
    const bytes = Buffer.byteLength(file.contents, "utf-8");
    const mode = file.executable === true ? " (executable)" : "";
    console.log(`  + ${file.path.padEnd(42)} ${String(bytes).padStart(6)} bytes${mode}`);
  }
  for (const copy of plan.copies) console.log(`  + ${copy.to.padEnd(42)}    copied from the payload`);

  if (plan.notes.length > 0) {
    console.log("\nnotes");
    for (const note of plan.notes) console.log(`  · ${note}`);
  }
}

// ── writing ──────────────────────────────────────────────────────────────────

/**
 * Whetstone's own payload directory, holding the skills copied verbatim into the
 * target. Located by walking up from this module rather than by a hard-coded
 * relative path, so it works the same from `src/` under tsx and from `dist/`
 * after a build.
 *
 * IT MUST STOP AT WHETSTONE'S OWN PACKAGE ROOT. Installed as a dependency the
 * module sits at `<target>/node_modules/whetstone/dist/commands/`, and an unbounded
 * walk escapes the package and finds `<target>/.wst/skills` — the TARGET's skills.
 * `init` would then copy a project's own skills back onto itself and report success,
 * which looks exactly like a correct bootstrap. So the walk is bounded by the
 * package.json that declares this package, and never crosses a node_modules boundary.
 */
const PACKAGE_NAME = "whetstone";

/**
 * Whetstone's own skills, keyed by their `from` path.
 *
 * Read here rather than at write time because `planInit` audits them: a skill is
 * copied verbatim into a repo that has never heard of Whetstone, so a sentence in
 * one naming `docs/PARALLEL.md` dangles there. An empty map is a legitimate
 * result — a published package without its payload — and produces "not audited",
 * which is a violation, not a pass.
 */
async function readSkills(payloadRoot: string | null): Promise<ReadonlyMap<string, string>> {
  const texts = new Map<string, string>();
  if (payloadRoot === null) return texts;
  for (const copy of skillCopies()) {
    try {
      texts.set(copy.from, await readFile(join(payloadRoot, copy.from), "utf-8"));
    } catch {
      /* absent here is the same as unreadable: reported, not passed */
    }
  }
  return texts;
}

async function findPayloadRoot(): Promise<string | null> {
  let dir = import.meta.dirname;
  for (;;) {
    // Reached this package's own root? Answer from here, and never look higher.
    try {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8")) as {
        name?: string;
      };
      if (pkg.name === PACKAGE_NAME) {
        const root = join(dir, DEFINITION_DIR);
        return (await exists(join(root, "skills"))) ? root : null;
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

/** First of these that exists, or null. A missing README is a fact, not an error. */
async function readFirst(root: string, candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      return await readFile(join(root, candidate), "utf-8");
    } catch {
      /* try the next */
    }
  }
  return null;
}

/** Where `--propose` writes its draft when `--out` is not given. */
const DEFAULT_ANSWERS_FILE = ".wst-answers.json";

/** Whether there is a judge to call at all. Checked before advertising `--propose`. */
async function judgeAvailable(): Promise<boolean> {
  return (await judgeFor(DEFAULT_CONFIG).describe()).version !== null;
}

/**
 * Draft the answers with the judge and write them for the human to edit.
 *
 * It writes a FILE rather than proceeding straight to `planInit`. That gap is the
 * point: a draft that flowed directly into a written `.wst/` would make the model's
 * reading of the project the project's constitution, with no moment where anyone
 * had to look at it. ADR-0003 calls the human gate the moat.
 */
async function proposeAnswers(
  facts: RepoFacts,
  stack: ReturnType<typeof detectStack>,
  root: string,
  outPath: string,
): Promise<number> {
  console.log(`${banner()}\n\ninit --propose — ${root}`);
  printDetection(stack);
  console.log("\nasking the judge to draft the answers...\n");

  // The judge asked for this on the first live run and could not go and get it.
  const readme = await readFirst(root, ["README.md", "readme.md", "README", "docs/README.md"]);

  const result = await judgeFor(DEFAULT_CONFIG).judge({
    lens:
      "You draft project definitions for review by the project's owner. You argue " +
      "from evidence you were given and never from assumption. You propose; you do " +
      "not decide.",
    prompt: buildProposalPrompt(facts, stack, readme),
    schema: ProposalSchema,
  });

  if (!result.ok) {
    // The judge failing is the DRAFTER being broken, not a fact about the repo —
    // the same distinction the gate draws. Fall back to the questions rather than
    // writing a half-answer.
    console.error(
      `the judge could not produce a draft (${result.error.kind}): ${result.error.detail}\n` +
        `  Nothing was written. Answer the questions yourself with \`wst init\`.`,
    );
    return 1;
  }

  const target = resolve(root, outPath);
  await writeFile(target, `${JSON.stringify(proposalToAnswers(result.value), null, 2)}\n`, "utf-8");

  console.log(renderProposal(result.value));
  console.log(`\nwrote ${outPath} ($${result.costUsd.toFixed(4)})`);
  console.log(`  Edit it, then: wst init --answers ${outPath}`);
  return 0;
}

async function writePlan(plan: InitPlan, root: string): Promise<void> {
  for (const file of plan.files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents, "utf-8");
    // A hook without the executable bit is a hook that silently never runs, and
    // "the guard is installed but does nothing" is the worst state to be in.
    if (file.executable === true) await chmod(target, 0o755);
  }

  // What was audited is what gets written. The copies used to be re-read from
  // the payload directory here, which meant `planInit` verified one text and the
  // repo received another — and since `payloadSkill` now strips the changelog,
  // those two would have differed by every line the audit exists to catch.
  for (const copy of plan.copies) {
    if (copy.contents === undefined) continue; // reported as unaudited by the plan
    const target = join(root, copy.to);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, copy.contents, "utf-8");
  }
}

/**
 * `.wst-lane` is written at the worktree root by a worker, into a
 * worktree this command never sees — so they cannot be a plan `file` guarded by
 * `collisionsIn`. What CAN be done now is make sure the target repo's own
 * `.gitignore` already excludes them, so the very first leased worktree is not
 * born dirty.
 *
 * Read-modify-write rather than `writePlan`'s all-or-nothing collision guard:
 * almost every repo already has a `.gitignore`, and treating it as a collision
 * would make `init` refuse on the majority of real repos to fix a problem that
 * has nothing to do with the rest of that file's content. Only the entries
 * actually missing are appended, so a second `wst init` does not duplicate a
 * line a first run (or the repo's own history) already added.
 */
async function ensureRootGitignored(root: string): Promise<void> {
  const target = join(root, ".gitignore");
  let current: string | null;
  try {
    current = await readFile(target, "utf-8");
  } catch {
    current = null;
  }

  const present = new Set((current ?? "").split("\n").map((line) => line.trim()));
  const missing = ROOT_GITIGNORE_ENTRIES.filter((entry) => !present.has(entry));
  if (missing.length === 0) return;

  const stanza = renderRootGitignoreStanza(missing);
  if (current === null) {
    await writeFile(target, stanza, "utf-8");
    return;
  }
  const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  await writeFile(target, `${current}${sep}\n${stanza}`, "utf-8");
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

  // --propose: the judge drafts, the human signs.
  if (opts.propose === true) {
    return await proposeAnswers(facts, stack, root, opts.out ?? DEFAULT_ANSWERS_FILE);
  }

  if (answers === null) {
    console.log(`${banner()}\n\ninit — ${root}`);
    printDetection(stack);
    printQuestions();
    if (await judgeAvailable()) {
      console.log(
        "\nOr let the judge draft them from what it can see:\n" +
          "  wst init --propose        (one model call, measured at ~$0.15)\n" +
          "It proposes; you edit and sign. The risk answer is yours either way.",
      );
    }
    return 0;
  }

  // Resolved BEFORE the plan, not at write time: the reference-closure audit runs
  // inside `planInit`, and it cannot audit the eight copied skills without their
  // text. Missing text is reported as unaudited, never as clean.
  const payloadRoot = await findPayloadRoot();
  const skillTexts = await readSkills(payloadRoot);

  // What the TARGET repo already has, which is not the same as what Whetstone
  // ships. Only `--force` re-renders AGENTS.md, and until now that re-render
  // listed the eight shipped names — so a skill written by hand after init was
  // invisible to every agent that read the file.
  const presentSkills = await readdir(join(root, DEFINITION_DIR, "skills"))
    .then((names) => names.filter((n) => n.endsWith(".md")).sort().map((n) => `skills/${n}`))
    .catch(() => [] as string[]);

  let plan: InitPlan;
  try {
    plan = planInit({
      facts,
      answers,
      clock: { now: () => new Date() },
      skillTexts,
      presentSkills,
      options: {
        ...(opts.agentLens !== undefined ? { seedAgentLens: opts.agentLens } : {}),
        ...(opts.definitionsOnly === true ? { definitionsOnly: true } : {}),
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
  // touch.
  const collisions = collisionsIn(plan, await existingOf(plan, root));

  if (collisions.length > 0) {
    if (opts.force !== true) {
      console.error(`\n${renderCollisions(collisions)}`);
      return 1;
    }
    // --force replaces generated files. It does not empty an append-only log:
    // that is not a file being regenerated, it is a project's evidence, and
    // non-negotiable 4 says a correction is appended and never overwritten.
    // Someone had to invent a backup-force-restore dance to survive this.
    const protectedPaths = collisions.filter((c) => !c.forceable);
    if (protectedPaths.length > 0) {
      console.error(
        `\n--force will not write ${String(protectedPaths.length)} append-only file(s):\n` +
          protectedPaths.map((c) => `  ${c.path}\n      ${c.stake}`).join("\n") +
          `\n\n  Move them aside if you truly want them gone. Everything else would be written.`,
      );
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

  if (payloadRoot === null) {
    console.error(
      "\ncould not locate Whetstone's own skills directory, so the skills were NOT copied.\n" +
        `  Everything else was written. Copy \`${DEFINITION_DIR}/skills/\` across by hand, or re-run from a\n` +
        "  checkout rather than a published package.",
    );
  }

  try {
    await writePlan(plan, root);
    await ensureRootGitignored(root);
  } catch (cause) {
    console.error(`\nwrite failed: ${(cause as Error).message}`);
    return 1;
  }

  const written = plan.files.length + (payloadRoot === null ? 0 : plan.copies.length);
  console.log(`\nwrote ${written} files. Review them, then commit:`);
  console.log(`  git add ${DEFINITION_DIR} .claude AGENTS.md CLAUDE.md`);
  console.log('  git commit -m "chore: bootstrap the agent workflow"');
  return payloadRoot === null ? 1 : 0;
}
