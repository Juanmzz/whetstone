/**
 * `wst run <task>` — the end-to-end conductor.
 *
 *   lease a worktree -> branch it -> build the charter -> dispatch a crewmate
 *   -> gate the result -> report -> release
 *
 * Composition root: it wires adapters and sequences them. Every decision it makes
 * lives in `core/` (the charter, the gate verdict); nothing is judged here.
 */

import { execFile } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  buildCharter,
  branchNameFor,
  strictPathsFrom,
  ORIENTATION_DOCS,
  type GatingCheck,
} from "../core/dispatch/charter.js";
import { definitionRoot, loadRegistry, loadTriageRules } from "../shell/sdd.js";
import { createGitAdapter } from "../shell/git.js";
import { createTreehouseAdapter } from "../shell/treehouse.js";
import { createCrewmateAdapter, type CrewmateMode } from "../shell/crewmate.js";
import { runGate } from "./gate.js";

const exec = promisify(execFile);

/**
 * Which orientation docs exist WHERE THE CREWMATE WILL WORK.
 *
 * Stat'd in the worktree, never in the orchestrator's repo. An untracked `.sdd/`
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

export interface RunOptions {
  readonly task: string;
  /** Print the charter and exit without spending anything. */
  readonly dryRun?: boolean;
  readonly lane?: string;
  /**
   * Lease the worktree, branch it, write the charter — and stop before dispatching.
   *
   * For working the way a multiplexer shows: the agent runs in a session you can see,
   * because you opened it. `wst run` spawns `claude -p` headless, which is correct for
   * automation and invisible to herdr, tmux or anything else that displays panes.
   */
  readonly prepare?: boolean;
  readonly model?: string;
  readonly budgetUsd?: number;
  readonly mode?: CrewmateMode;
  /** Keep the worktree even on success, for inspection. */
  readonly keep?: boolean;
}

export async function runRun(opts: RunOptions, cwd: string = process.cwd()): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = (await git.repoRoot()) ?? cwd;
  const sddRoot = definitionRoot(repoRoot);
  const registry = await loadRegistry(sddRoot);
  const triage = await loadTriageRules(sddRoot);

  const gatingChecks: GatingCheck[] = registry.active.map((c) => ({
    id: c.id,
    severity: c.severity,
    description: c.description,
  }));

  // Derived, never literal. Hardcoding Whetstone's own three told a crewmate in
  // `agilpay-backend` that three directories it would never touch were the dangerous
  // ones, and said nothing about `migrations/` (sig-0041).
  const strictPaths = strictPathsFrom(triage.rules);

  const branch = branchNameFor(opts.task);
  const treehouse = createTreehouseAdapter(repoRoot);

  if (opts.dryRun === true) {
    console.log(
      buildCharter({
        task: opts.task,
        worktreePath: "<leased at dispatch>",
        branch,
        lane: opts.lane ?? null,
        gatingChecks,
        strictPaths,
        // No worktree has been leased, so this is the orchestrator's own tree. It
        // over-reports anything untracked; the dispatch path below stats the real one.
        presentDocs: await presentDocsIn(repoRoot),
      }),
    );
    return 0;
  }

  if (!(await treehouse.available())) {
    console.error("treehouse is not installed — `wst run` needs it for worktree isolation");
    return 1;
  }

  console.log(`wst run — ${opts.task}\n`);
  const worktree = await treehouse.lease(`wst-run-${branch.replace("run/", "")}`);
  console.log(`  worktree  ${worktree.path}`);

  // `finally` runs AFTER `return`, so a failure path cannot protect the worktree by
  // returning early — it has to say so explicitly. Getting this wrong would discard
  // the diff that is the entire evidence of what went wrong.
  let keepForInspection = opts.keep === true;
  const release = async () => {
    if (keepForInspection) return;
    await treehouse.release(worktree.path).catch(() => undefined);
  };

  try {
    // Branch from the ORCHESTRATOR's current commit, not from whatever the pooled
    // worktree happens to sit at — a fresh pool hands you the default branch.
    const { stdout: baseOut } = await exec("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    const base = baseOut.trim();
    await exec("git", ["fetch", "--no-tags", repoRoot, base], { cwd: worktree.path }).catch(
      () => undefined,
    );
    await exec("git", ["reset", "--hard", base], { cwd: worktree.path });
    await exec("git", ["switch", "-C", branch], { cwd: worktree.path });

    // node_modules is not in the tree, so a fresh worktree cannot run its own
    // checks. Found by the first crewmate, which reported having to install.
    await exec("ln", ["-sfn", join(repoRoot, "node_modules"), "node_modules"], {
      cwd: worktree.path,
    }).catch(() => undefined);
    console.log(`  branch    ${branch}`);
    if (opts.lane !== undefined) {
      await exec("sh", ["-c", `printf '%s\\n' '${opts.lane}' > .wst-lane`], { cwd: worktree.path });
      console.log(`  lane      ${opts.lane} (boundary enforced by hook)`);
    }

    const charter = buildCharter({
      task: opts.task,
      worktreePath: worktree.path,
      branch,
      lane: opts.lane ?? null,
      gatingChecks,
      strictPaths,
      presentDocs: await presentDocsIn(worktree.path),
    });

    // --prepare: everything up to the dispatch, then stop.
    //
    // The workdir is treehouse's job, the charter is Whetstone's, and the WINDOW is
    // nobody's here — that is the point. Spawning `claude -p` headless is why herdr,
    // tmux and any other multiplexer have nothing to show: there is no terminal to
    // attach to. Handing the worktree back lets a human, a multiplexer or a harness
    // supply the session, without Whetstone taking a dependency on any of them.
    //
    // A notary can prepare the file. It does not sit down and do the work.
    if (opts.prepare === true) {
      const charterPath = join(worktree.path, ".wst-charter.md");
      await writeFile(charterPath, `${charter}\n`, "utf-8");
      keepForInspection = true; // the worktree IS the deliverable here

      console.log(`\n  prepared — nothing was dispatched, nothing was spent.\n`);
      console.log(`  worktree  ${worktree.path}`);
      console.log(`  branch    ${branch}`);
      console.log(`  charter   .wst-charter.md (in the worktree)\n`);
      console.log(`  Open a session there and start an agent:`);
      console.log(`    cd ${worktree.path} && claude\n`);
      console.log(`  When it is done, gate the work it committed:`);
      console.log(`    wst gate --range ${base.slice(0, 7)}..HEAD --no-lens\n`);
      console.log(`  Then return the worktree:  treehouse return ${worktree.path}`);
      return 0;
    }

    console.log(`\n  dispatching crewmate...`);
    const crewmate = createCrewmateAdapter();
    const result = await crewmate.dispatch({
      charter,
      worktreePath: worktree.path,
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.budgetUsd !== undefined ? { maxBudgetUsd: opts.budgetUsd } : {}),
      ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
    });

    console.log(
      `  crewmate  ${result.ok ? "finished" : "FAILED"} in ${Math.round(result.durationMs / 1000)}s · $${result.costUsd.toFixed(4)}`,
    );
    if (!result.ok) {
      keepForInspection = true;
      console.error(`\n  crewmate error: ${result.error ?? "unknown"}`);
      console.log(`  worktree kept for inspection: ${worktree.path}`);
      return 1;
    }
    if (result.text !== "") console.log(`\n--- crewmate report ---\n${result.text}\n`);

    // Gate the crewmate's work IN ITS OWN WORKTREE, against the base it branched
    // from. This is the whole point: the worker does not decide whether its work
    // is acceptable.
    // THE RANGE MATTERS. `HEAD` means working-tree-vs-HEAD, which is EMPTY once the
    // crewmate has committed — the gate then verifies nothing and honestly says so,
    // while the run reports PASSED. Gate the commits the crewmate actually made.
    const { stdout: changed } = await exec(
      "git",
      ["diff", "--name-only", `${base}..HEAD`],
      { cwd: worktree.path },
    );
    if (changed.trim() === "") {
      keepForInspection = true;
      console.error(`\n  the crewmate committed nothing — there is no work to gate.`);
      return 1;
    }

    console.log(`--- gate (${base.slice(0, 7)}..HEAD) ---`);
    // `noReceipts`: this gate is judging the crewmate, INSIDE the crewmate's own
    // worktree, where the crewmate had write access to `.sdd/receipts/`. Measured on
    // the first real dispatch — every check came back `skipped (receipt)`, so the
    // supervising gate verified nothing and the worker's own run had vouched for it.
    const gateExit = await runGate(
      { range: `${base}..HEAD`, noReceipts: true },
      worktree.path,
    );

    if (gateExit !== 0) {
      // Never discard a worktree whose work did not pass. The diff is the evidence.
      keepForInspection = true;
      console.log(`\n  gate did not pass — worktree kept: ${worktree.path}`);
      console.log(`  branch \`${branch}\` holds the work; inspect, fix, or discard.`);
      return gateExit;
    }

    // The worktree goes back to the pool, but the branch is a repo-wide ref and
    // survives. Naming the released path here would send you to a reset directory.
    console.log(`\n  PASSED — the work is on branch \`${branch}\`.`);
    console.log(`  Review it:  git log -p ${branch}`);
    console.log(`  Merge it:   git merge --no-ff ${branch}`);
    console.log(`  A crewmate never merges its own work; that call is yours.`);
    return 0;
  } catch (cause) {
    keepForInspection = true;
    console.error(`\n  run failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    console.log(`  worktree kept for inspection: ${worktree.path}`);
    return 1;
  } finally {
    // Released ONLY on the clean path — every failure branch sets keepForInspection.
    await release();
  }
}
