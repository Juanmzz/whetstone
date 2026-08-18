/**
 * `wst prepare <task>` — the briefing, and nothing after it.
 *
 *   lease a worktree -> branch it -> build the charter -> write it in -> print the path
 *
 * adr-0014 split `wst run` here and deleted the other half: dispatch a crewmate, wait
 * out a 30-minute timeout, gate what came back, release the worktree. The charter is
 * what survived: it renders *"what will gate your work"* from the registry and triage
 * rules AS THEY ARE RIGHT NOW, so it cannot go stale the way a hand-written prompt
 * does — the hardcoded version sent a crewmate in a foreign repo to two files that
 * were not there (sig-0041).
 *
 * NOTHING HERE RELEASES THE WORKTREE, on purpose. The lease is the human's from minute
 * zero; `treehouse return` belongs to whoever knows whether the work is finished, and
 * this process exits long before anyone does. That is ADR-0014's decision, not an
 * omission.
 *
 * There is also no gate here any more. Enforcement is the push: git config is shared
 * across worktrees (no `extensions.worktreeConfig`), so a crewmate pushing from a leased
 * worktree fires the same `pre-push` gate, and CI runs the full gate on the PR. Work
 * abandoned in a worktree is never gated — that is the cost ADR-0014 accepted, and it is
 * acceptable only because abandoned work does not land.
 *
 * Composition root: it wires adapters and sequences them. Every decision it makes lives
 * in `core/` (the charter); nothing is judged here.
 */

import { execFile } from "node:child_process";
import { access, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { environmentGaps } from "../core/dispatch/environment.js";
import { prepareEnvelope } from "../core/dispatch/machine.js";
import { laneReport } from "../core/dispatch/lane.js";
import {
  buildCharter,
  branchNameFor,
  strictPathsFrom,
  ORIENTATION_DOCS,
  type GatingCheck,
} from "../core/dispatch/charter.js";
import { loadRegistry, loadTriageRules, resolveDefinitionRoot } from "../shell/sdd.js";
import { createGitAdapter } from "../shell/git.js";
import { assertWorktreeAt, gitEnv } from "../shell/git.js";
import { createTreehouseAdapter } from "../shell/treehouse.js";

const exec = promisify(execFile);

/**
 * Which orientation docs exist WHERE THE CREWMATE WILL WORK.
 *
 * Stat'd in the worktree, never in the orchestrator's repo. An untracked `.wst/`
 * exists in one and not the other, and that gap is exactly what produced the field
 * report's silent failure (sig-0044) — pointing at the orchestrator's copy would
 * reintroduce the bug this fixes.
 */
async function presentDocsIn(root: string): Promise<string[]> {
  const found = await Promise.all(
    ORIENTATION_DOCS.map(async (doc) => {
      try {
        await access(join(root, doc.path));
        return doc.path;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((p): p is string => p !== null);
}

export interface PrepareOptions {
  readonly task: string;
  /**
   * Print the charter and exit without leasing anything.
   *
   * Kept, and worth more than it was before ADR-0014: every real `prepare` now holds a
   * pool slot until a human returns it, so reading the briefing must not cost one.
   */
  readonly dryRun?: boolean;
  readonly lane?: string;
  /** The same answer as data, for an orchestrator rather than a reader. */
  readonly json?: boolean;
}

export async function runPrepare(
  opts: PrepareOptions,
  cwd: string = process.cwd(),
): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = (await git.repoRoot()) ?? cwd;
  const definitionRoot = await resolveDefinitionRoot(repoRoot);
  const registry = await loadRegistry(definitionRoot);
  const triage = await loadTriageRules(definitionRoot);

  const gatingChecks: GatingCheck[] = registry.active.map((c) => ({
    id: c.id,
    severity: c.severity,
    description: c.description,
  }));

  // Derived, never literal. Hardcoding Whetstone's own three told a crewmate in
  // a payments API that three directories it would never touch were the dangerous
  // ones, and said nothing about `migrations/` (sig-0041).
  const strictPaths = strictPathsFrom(triage.rules);

  // Still `run/`: `branchNameFor` lives in `core/dispatch/charter.ts`, which ADR-0014
  // keeps untouched, and a branch prefix is not worth invalidating its tests over.
  const branch = branchNameFor(opts.task);
  const treehouse = createTreehouseAdapter(repoRoot);

  // Emitted per repo with its lane globs compiled in, so it is here and not in a
  // repo Whetstone bootstrapped. The charter must not promise it where it is absent.
  const laneGuard = await stat(join(repoRoot, ".claude", "hooks", "lane-guard.mjs"))
    .then(() => true)
    .catch(() => false);

  if (opts.dryRun === true) {
    if (opts.json === true) {
      // Both flags together. Silently printing prose because one of them won
      // is how a caller ends up parsing a charter it asked for as data.
      console.log(
        JSON.stringify(
          { dryRun: true, leased: false, branch, lane: opts.lane ?? null, charter: buildCharter({
            task: opts.task,
            worktreePath: "<leased when you run this for real>",
            branch,
            lane: opts.lane ?? null,
            laneGuard,
            gatingChecks,
            strictPaths,
            presentDocs: await presentDocsIn(repoRoot),
          }) },
          null,
          2,
        ),
      );
      return 0;
    }

    console.log(
      buildCharter({
        task: opts.task,
        worktreePath: "<leased when you run this for real>",
        branch,
        lane: opts.lane ?? null,
        laneGuard,
        gatingChecks,
        strictPaths,
        // No worktree has been leased, so this is the orchestrator's own tree. It
        // over-reports anything untracked; the real path below stats the leased one.
        presentDocs: await presentDocsIn(repoRoot),
      }),
    );
    return 0;
  }

  if (!(await treehouse.available())) {
    console.error("treehouse is not installed — `wst prepare` needs it for worktree isolation");
    return 1;
  }

  console.log(`wst prepare — ${opts.task}\n`);
  const worktree = await treehouse.lease(`wst-${branch.replace("/", "-")}`);
  console.log(`  worktree  ${worktree.path}`);

  try {
    // Branch from the ORCHESTRATOR's current commit, not from whatever the pooled
    // worktree happens to sit at — a fresh pool hands you the default branch.
    const { stdout: baseOut } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      env: gitEnv(),
    });
    const base = baseOut.trim();

    // ASK BEFORE DESTROYING. Everything below this line resets a tree, moves a
    // branch or overwrites a symlink, and every one of them trusts `cwd` — which
    // `GIT_DIR` overrides. `sig-82dec46b` is what that costs: the main repository's
    // index written twice by commands that believed they were elsewhere. Stripping
    // the environment removes the cause that was found; this refuses to act on a
    // target that cannot prove it is the target.
    await assertWorktreeAt(worktree.path);
    await exec("git", ["fetch", "--no-tags", repoRoot, base], {
      cwd: worktree.path,
      env: gitEnv(),
    }).catch(
      () => undefined,
    );
    await exec("git", ["reset", "--hard", base], { cwd: worktree.path, env: gitEnv() });
    await exec("git", ["switch", "-C", branch], { cwd: worktree.path, env: gitEnv() });

    // node_modules is not in the tree, so a fresh worktree cannot run its own
    // checks. Found by the first crewmate, which reported having to install.
    await exec("ln", ["-sfn", join(repoRoot, "node_modules"), "node_modules"], {
      cwd: worktree.path,
    }).catch(() => undefined);
    console.log(`  branch    ${branch}`);

    // A worktree holds what git tracks and nothing else. Say what it is missing
    // rather than letting it surface later as a check failing on a file the work
    // never touched, or as a green that only means "skipped".
    const ignored = await exec("git", ["ls-files", "--others", "--directory", "-i", "--exclude-standard"], {
      cwd: repoRoot,
      env: gitEnv(),
    })
      .then(({ stdout }) => stdout.split("\n").map((l) => l.replace(/\/$/, "")).filter(Boolean))
      .catch(() => [] as string[]);
    for (const gap of environmentGaps({ untracked: ignored, linked: ["node_modules"] })) {
      console.log(`  missing   ${gap.paths.slice(0, 4).join(", ")}${gap.paths.length > 4 ? ` (+${String(gap.paths.length - 4)})` : ""}`);
      console.log(`            ${gap.why}`);
    }
    if (opts.lane !== undefined) {
      await exec("sh", ["-c", `printf '%s\\n' '${opts.lane}' > .wst-lane`], { cwd: worktree.path });
      // Only claim the boundary where something reads `.wst-lane`. The guard is
      // emitted per repo with its lane globs compiled in, so it exists here and
      // not in a repo Whetstone bootstrapped.
      console.log(`  lane      ${laneReport(opts.lane, laneGuard) ?? opts.lane}`);
    }

    const charterPath = join(worktree.path, ".wst-charter.md");
    await writeFile(
      charterPath,
      `${buildCharter({
        task: opts.task,
        worktreePath: worktree.path,
        branch,
        lane: opts.lane ?? null,
        laneGuard,
        gatingChecks,
        strictPaths,
        presentDocs: await presentDocsIn(worktree.path),
      })}\n`,
      "utf-8",
    );

    // The workdir is treehouse's job, the charter is Whetstone's, and the WINDOW is
    // nobody's here — that is the point. Handing the worktree back lets a human, a
    // multiplexer or a harness supply the session, without Whetstone taking a
    // dependency on any of them.
    //
    // A notary can prepare the file. It does not sit down and do the work.
    if (opts.json === true) {
      // The three paths a caller acts on, without parsing English for them.
      console.log(
        JSON.stringify(
          prepareEnvelope({
            task: opts.task,
            worktreePath: worktree.path,
            branch,
            charterPath,
            lane: opts.lane ?? null,
            laneGuard,
            gaps: environmentGaps({ untracked: ignored, linked: ["node_modules"] }),
          }),
          null,
          2,
        ),
      );
      return 0;
    }

    console.log(`\n  prepared — nothing was dispatched, nothing was spent.\n`);
    console.log(`  worktree  ${worktree.path}`);
    console.log(`  branch    ${branch}`);
    console.log(`  charter   .wst-charter.md (in the worktree)\n`);
    console.log(`  Open a session there and start an agent:`);
    console.log(`    cd ${worktree.path} && claude\n`);
    console.log(`  When it is done, gate the work it committed:`);
    console.log(`    wst gate --range ${base.slice(0, 7)}..HEAD --no-lens\n`);
    console.log(`  The lease is yours until you return it:  treehouse return ${worktree.path}`);
    return 0;
  } catch (cause) {
    // The worktree stays leased here too, and the message has to say so — a half-set-up
    // worktree nobody knows they hold is the accumulation ADR-0014 named.
    console.error(`\n  prepare failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    console.log(`  the worktree is still leased to you: ${worktree.path}`);
    console.log(`  return it with:  treehouse return ${worktree.path}`);
    return 1;
  }
}
