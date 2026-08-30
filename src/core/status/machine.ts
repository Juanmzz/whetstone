/**
 * `wst status` as data.
 *
 * PURE. A report in, a JSON-safe object out.
 */

import { prePushGate, type PluginInstall, type StatusReport } from "./report.js";

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
      // One predicate, not a string compare (`sig-4b3339fb`). What an agent asked
      // is whether a push is gated, so a chained gate answers true.
      prePush: prePushGate(facts.hooks, facts.repoRoot) !== "off",
      plugin: facts.plugin.install,
    },
    repo: {
      root: facts.repoRoot,
      branch: facts.branch,
      definition: facts.definitionPresent,
    },
    judge: {
      name: facts.judge.name,
      version: facts.judge.version,
    },
  };
}
