/**
 * `wst init` — composition root. Gather the facts, call the core, show the plan,
 * write the files. Every decision lives in `src/core/init/`; if a judgement call
 * appears in this file it is in the wrong layer.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { banner } from "../banner.js";
import { createGitAdapter } from "../shell/git.js";
import { probeCommands } from "../shell/probe.js";
import type { Probes } from "../core/init/probe.js";
import { gatherFacts } from "../shell/repo-facts.js";
import { DEFINITION_DIR } from "../core/paths.js";
import { collisionsIn, renderCollisions } from "../core/init/collisions.js";
import { openInterview, pressIn, renderInterview } from "../core/tui/interview.js";
import { openPicker, pressPicker, renderPicker } from "../core/tui/picker.js";
import { HARNESSES, judgeFor as adapterFor } from "../core/init/harness.js";
import type { Agent } from "../core/config/schema.js";
import { confirm } from "../shell/confirm.js";
import { startSpinner } from "../shell/spinner.js";
import { paint, rawKeys, restore } from "../shell/tui.js";
import { stagePaths } from "../core/init/stage.js";
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
  AnswersSchema,
  BASE_FILE,
  renderBase,
  MAX_FILES,
  NO_RISK,
  ROOT_GITIGNORE_ENTRIES,
  buildInterview,
  type DraftedAnswers,
  detectStack,
  planInit,
  renderRootGitignoreStanza,
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
  /**
   * `--no-probe`, which commander delivers as `false`. Skips running the repo's
   * own commands, after which every seeded check starts at `warn`.
   */
  readonly probe?: boolean;
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


// ── answers ──────────────────────────────────────────────────────────────────

/**
 * Validated rather than cast. The answers file is hand-written (usually by an
 * agent), and a typo'd key silently becoming `undefined` produces a constitution
 * with a hole in it — the exact outcome `validateAnswers` exists to prevent, one
 * layer too late to catch it.
 */

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
        `--strict "${entry}" has no reason. Use "<glob>:<why it earns full TDD>": a rule ` +
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
    console.log("  nothing: no manifest, no lockfile, no tests");
    return;
  }
  for (const line of stack.evidence) console.log(`  ${line}`);
}

function printQuestions(stack: ReturnType<typeof detectStack>): void {
  const questions = buildInterview(stack.declared);
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

/**
 * Which harnesses read this repo. One screen, before anything else.
 *
 * It decides two things `init` used to decide for you: which front-door pointer
 * gets written, and which adapter may draft the answers. Null when the human
 * backed out.
 */
async function askHarnesses(): Promise<readonly string[] | null> {
  let state = openPicker(
    "wst init  ·  your harnesses",
    "Which agent harnesses read this repo? `AGENTS.md` is written either way; " +
      "one of these will be asked to draft your answers.",
    HARNESSES.map((h) => ({
      value: h.id,
      label: h.label,
      detail: h.readsAgentsMd
        ? "reads AGENTS.md on its own, so nothing else is written for it"
        : `writes ${String(h.pointer)}, one line pointing at AGENTS.md`,
    })),
  );

  const keys = rawKeys(process.stdin, () => {
    keys.close();
    restore(process.stdout);
    process.exit(130);
  });

  try {
    for (;;) {
      paint(process.stdout, renderPicker(state));
      const result = pressPicker(state, await keys.next());
      state = result.state;
      if (result.action.kind === "cancel") return null;
      if (result.action.kind === "done") return result.action.picked;
    }
  } finally {
    keys.close();
    restore(process.stdout);
  }
}

/**
 * Which of the seeded checks stay on. One screen, after the plan is known.
 *
 * They used to arrive `enabled: false` so nobody gained a check they had not
 * asked for, and the result was a rule nobody ever read. The offer belongs where
 * it can be declined, which is here, before anything is written. Null when the
 * human backed out.
 */
async function askChecks(checks: InitPlan["checks"]): Promise<readonly string[] | null> {
  let state = openPicker(
    "wst init  ·  what will stop you",
    "These are the checks this repo gets. Untick any you do not want; " +
      "`block` refuses a push, `warn` says so and lets it through.",
    checks.map((c) => ({
      value: c.id,
      label: `${c.severity.toUpperCase().padEnd(5)} ${c.id}`,
      detail:
        c.severity === "block"
          ? "refuses the push. Seeded here because init watched it pass."
          : "reports and lets the push through. Raise it in the file once it is green.",
    })),
    checks.map((c) => c.id),
  );

  const keys = rawKeys(process.stdin, () => {
    keys.close();
    restore(process.stdout);
    process.exit(130);
  });

  try {
    for (;;) {
      paint(process.stdout, renderPicker(state));
      const result = pressPicker(state, await keys.next());
      state = result.state;
      if (result.action.kind === "cancel") return null;
      if (result.action.kind === "done") {
        const on = result.action.picked;
        return checks.map((c) => c.id).filter((id) => !on.includes(id));
      }
    }
  } finally {
    keys.close();
    restore(process.stdout);
  }
}

/**
 * The judge reads the repo and drafts what no file declares.
 *
 * A failure here is the DRAFTER being broken and not a fact about the project,
 * so it falls back to blank fields rather than to half an answer. The same
 * distinction the gate draws between `blocked` and `incomplete`.
 */
async function draftAnswers(
  facts: RepoFacts,
  stack: ReturnType<typeof detectStack>,
  root: string,
  agent: Agent,
): Promise<DraftedAnswers> {
  const readme = await readFirst(root, ["README.md", "readme.md", "README", "docs/README.md"]);
  const spinner = startSpinner(process.stdout, `${agent} is reading this repo`);

  const result = await judgeFor({ ...DEFAULT_CONFIG, agent }).judge({
    lens:
      "You draft project definitions for review by the project's owner. You argue " +
      "from evidence you were given and never from assumption. You propose; you do " +
      "not decide.",
    prompt: buildProposalPrompt(facts, stack, readme),
    schema: ProposalSchema,
  });

  if (!result.ok) {
    spinner.stop(`  could not draft (${result.error.kind}). Answer them yourself.`);
    return {};
  }

  spinner.stop(`  drafted in ${agent} for $${result.costUsd.toFixed(4)}. Check every field.`);
  const answers = proposalToAnswers(result.value);
  return {
    purpose: answers.purpose,
    risk: RISK_KEYS.filter((k) => answers.risk[k]),
    sourcePaths: answers.sourcePaths,
    strictPaths: answers.strictPaths,
    ...(answers.stack === null ? {} : { stack: answers.stack }),
  };
}

/** The interview, answered in the terminal. Null when the human backed out. */
async function askInterview(
  stack: ReturnType<typeof detectStack>,
  drafted: DraftedAnswers,
): Promise<InterviewAnswers | null> {
  let state = openInterview(buildInterview(stack.declared, drafted));
  const keys = rawKeys(process.stdin, () => {
    keys.close();
    restore(process.stdout);
    process.exit(130);
  });

  try {
    for (;;) {
      paint(process.stdout, renderInterview(state));
      const result = pressIn(state, await keys.next());
      state = result.state;
      if (result.action.kind === "cancel") return null;
      if (result.action.kind === "write") return result.action.answers;
    }
  } finally {
    keys.close();
    restore(process.stdout);
  }
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
  console.log(`${banner()}\n\ninit --propose: ${root}`);
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

/**
 * What `wst update` compares against later: the answers, and a hash per file.
 *
 * Committed, not runtime state. `renderWstGitignore` must never learn about it —
 * a base only one machine has answers a question only that machine can ask.
 */
/** The same number `wst --version` prints: what wrote this base. */
const VERSION = (createRequire(import.meta.url)("../../package.json") as { version: string }).version;

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

async function writeBase(
  plan: InitPlan,
  answers: InterviewAnswers,
  root: string,
): Promise<void> {
  const files: Record<string, string> = {};
  for (const file of plan.files) files[file.path] = sha256(file.contents);
  for (const copy of plan.copies) {
    if (copy.contents !== undefined) files[copy.to] = sha256(copy.contents);
  }

  const target = join(root, DEFINITION_DIR, BASE_FILE);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    renderBase({ version: VERSION, generatedAt: new Date().toISOString().slice(0, 10), answers, files }),
    "utf-8",
  );
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
  let harnesses: readonly string[] | undefined;
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
    // A terminal can answer the questions in place. Anything else gets the list
    // it always got, because a form nobody can fill in is a printed form.
    if (process.stdin.isTTY === true) {
      // BEFORE anything is asked and long before anything is spent. `init`
      // refuses to overwrite, and it used to find that out after a model call
      // and five questions. The full collision set needs a plan, which needs
      // answers; this is the half that needs neither.
      const already = await existingOf(
        { files: [{ path: `${DEFINITION_DIR}/constitution.md`, contents: "" }], copies: [] } as never,
        root,
      );
      if (already.length > 0 && opts.force !== true) {
        console.error(
          `${DEFINITION_DIR}/ already exists here, and \`init\` does not overwrite.
` +
            `  \`wst update\` reports what a newer Whetstone would write. \`--force\` lists what it
` +
            `  would replace before replacing it. Nothing was asked and nothing was spent.`,
        );
        return 1;
      }

      // The order is the point: you say who reads this repo, that decides who may
      // draft, and only then are you asked anything. `init` used to ask five
      // questions from a blank page and write a front door for a harness nobody
      // named (adr-0040).
      const picked = await askHarnesses();
      if (picked === null) return 0;
      harnesses = picked;

      const agent = adapterFor(picked);
      const drafted = agent === null ? {} : await draftAnswers(facts, stack, root, agent);

      const filled = await askInterview(stack, drafted);
      if (filled === null) return 0;
      answers = filled;
    }
  }

  if (answers === null) {
    console.log(`${banner()}\n\ninit: ${root}`);
    printDetection(stack);
    printQuestions(stack);
    if (await judgeAvailable()) {
      console.log(
        "\nOr let the judge draft them from what it can see:\n" +
          "  wst init --propose        (one model call, measured at ~$0.15)\n" +
          "It proposes; you edit and sign. The risk answer is yours either way.",
      );
    }
    return 0;
  }

  // Measured, not asserted. `init` already holds the three commands this repo
  // declares; running them once is what lets a seeded `block` rest on something.
  // Skipped under --dry-run, which writes nothing and should cost nothing.
  let probes: Probes | undefined;
  if (opts.dryRun !== true && opts.probe !== false) {
    // STDERR, like the gate's progress: `--json` writes an envelope to stdout and
    // a machine reading it must not have to strip narration out of the middle.
    const say = (line: string): void => {
      if (opts.json !== true) console.error(line);
    };
    say("\nrunning this repo's own commands once, so a seeded block rests on a run");
    probes = await probeCommands({ ...stack.commands }, root, (id, command) => {
      say(`  ${id.padEnd(10)} ${command}`);
    });
    for (const [id, result] of Object.entries(probes)) {
      const said = !result.ran ? `could not run: ${result.why}` : result.ok ? "green" : `exit ${String(result.exitCode)}`;
      say(`  ${id.padEnd(10)} ${said}`);
    }
  }

  let plan: InitPlan;
  try {
    plan = planInit({
      facts,
      answers,
      clock: { now: () => new Date() },
      ...(probes === undefined ? {} : { probes }),
      options: {
        ...(opts.agentLens !== undefined ? { seedAgentLens: opts.agentLens } : {}),
        ...(opts.definitionsOnly === true ? { definitionsOnly: true } : {}),
        ...(harnesses === undefined ? {} : { harnesses }),
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

  console.log(`${banner()}\n\ninit: ${root}`);
  // Offered before the plan is printed, so what is printed is what will be
  // written. Only where somebody is looking: off a terminal there is nobody to
  // ask, and the caller already meant it.
  if (opts.dryRun !== true && process.stdin.isTTY === true && process.stdout.isTTY === true) {
    const disabledChecks = await askChecks(plan.checks);
    if (disabledChecks === null) {
      console.log("  nothing written.");
      return 0;
    }
    if (disabledChecks.length > 0) {
      plan = planInit({
        facts,
        answers,
        clock: { now: () => new Date() },
        disabledChecks,
        ...(probes === undefined ? {} : { probes }),
          options: {
          ...(opts.agentLens !== undefined ? { seedAgentLens: opts.agentLens } : {}),
          ...(opts.definitionsOnly === true ? { definitionsOnly: true } : {}),
          ...(harnesses === undefined ? {} : { harnesses }),
        },
      });
    }
  }

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

  // ASKED, and last. Everything above is read-only, and the plan is on screen:
  // this is the one moment between five answers and a written layer. Skipped off
  // a terminal, where there is nobody to ask and the caller already meant it.
  if (
    !(await confirm(
      `\n  write ${String(plan.files.length + plan.copies.length)} file(s) into ${root}?`,
    ))
  ) {
    console.log("  nothing written.");
    return 0;
  }

  try {
    await writePlan(plan, root);
    await ensureRootGitignored(root);
    // LAST, and only on success. A base written before the files it describes
    // would survive a crash and claim hashes for content nobody wrote.
    await writeBase(plan, answers, root);
  } catch (cause) {
    console.error(`\nwrite failed: ${(cause as Error).message}`);
    return 1;
  }

  console.log(`\nwrote ${String(plan.files.length)} files. Review them, then commit:`);
  console.log(`  git add ${stagePaths(plan).join(" ")}`);
  console.log('  git commit -m "chore: bootstrap verification"');
  return 0;
}
