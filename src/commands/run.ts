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
import { join } from "node:path";
import { promisify } from "node:util";
import { buildCharter, branchNameFor, type GatingCheck } from "../core/dispatch/charter.js";
import { loadRegistry } from "../shell/sdd.js";
import { createGitAdapter } from "../shell/git.js";
import { createTreehouseAdapter } from "../shell/treehouse.js";
import { createCrewmateAdapter, type CrewmateMode } from "../shell/crewmate.js";
import { runGate } from "./gate.js";

const exec = promisify(execFile);

export interface RunOptions {
  readonly task: string;
  /** Print the charter and exit without spending anything. */
  readonly dryRun?: boolean;
  readonly lane?: string;
  readonly model?: string;
  readonly budgetUsd?: number;
  readonly mode?: CrewmateMode;
  /** Keep the worktree even on success, for inspection. */
  readonly keep?: boolean;
}

export async function runRun(opts: RunOptions, cwd: string = process.cwd()): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = (await git.repoRoot()) ?? cwd;
  const registry = await loadRegistry(join(repoRoot, ".sdd"));

  const gatingChecks: GatingCheck[] = registry.active.map((c) => ({
    id: c.id,
    severity: c.severity,
    description: c.description,
  }));

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
        strictPaths: ["src/core/", ".sdd/skills/", ".claude/hooks/"],
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
      strictPaths: ["src/core/", ".sdd/skills/", ".claude/hooks/"],
    });

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
    const gateExit = await runGate({ range: `${base}..HEAD` }, worktree.path);

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
