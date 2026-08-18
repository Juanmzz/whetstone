/**
 * `wst status` as data.
 *
 * PURE. A report in, a JSON-safe object out.
 *
 * ## Who reads this
 *
 * The plugin's init skill tells an agent to run `wst status` FIRST — before it
 * writes anything, to find out whether the repo already has a `.wst/`, whether
 * something else owns the git hooks, whether a judge is reachable. Until now the
 * answer came back as prose, so the agent had to read English to decide, and any
 * wording change was a silent behaviour change for every agent downstream.
 *
 * The human-facing renderer is unchanged and stays the default. This is the
 * second reader, not a replacement.
 *
 * ## Why `enforcement` is computed here and not left to the caller
 *
 * "Will the gate actually run from this directory?" is the question every other
 * one is asked in service of, and answering it means knowing that a pre-push hook
 * and a plugin Stop hook are two independent routes — either is enough, and
 * neither being live is the state worth acting on. Leaving that to each consumer
 * is how three of them end up disagreeing.
 */

import { hooksArmed, type PluginInstall, type StatusReport } from "./report.js";

export interface StatusEnvelope {
  /** Whether the repo is in a state the other commands can work from. */
  readonly ready: boolean;
  /** Anything that makes `ready` false. */
  readonly problems: readonly string[];
  /** Worth saying, does not block. */
  readonly warnings: readonly string[];
  /** Whether the gate has a route to run on its own from here. */
  readonly enforcement: {
    readonly prePush: boolean;
    readonly plugin: PluginInstall;
  };
  readonly repo: {
    readonly root: string | null;
    readonly branch: string | null;
    /** Whether `.wst/` is here. `legacy` is the pre-rename directory (adr-0012). */
    readonly definition: boolean;
    readonly legacy: boolean;
  };
  readonly judge: {
    readonly name: string;
    readonly version: string | null;
  };
}

export function statusEnvelope(report: StatusReport): StatusEnvelope {
  const { facts } = report;
  return {
    ready: report.ready,
    problems: [...report.problems],
    warnings: [...report.warnings],
    enforcement: {
      // `hooksArmed`, not a string compare. `sig-4b3339fb`: comparing the raw
      // `core.hooksPath` reported a demonstrably firing hook as unarmed, and the
      // renderer stopped doing it. Reusing the predicate is how the two answers
      // cannot drift.
      prePush: hooksArmed(facts.hooks, facts.repoRoot),
      plugin: facts.plugin.install,
    },
    repo: {
      root: facts.repoRoot,
      branch: facts.branch,
      definition: facts.definitionPresent,
      legacy: facts.legacyPresent,
    },
    judge: {
      name: facts.judge.name,
      version: facts.judge.version,
    },
  };
}
