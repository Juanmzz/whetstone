/**
 * Composition root for `wst status`: gather the facts, hand them to the pure
 * core, print. No decisions are made here, and no reading either.
 */

import { statusEnvelope } from "../core/status/machine.js";
import { renderStatusReport } from "../core/status/report.js";
import { gatherStatus } from "../shell/status.js";

export async function runStatus(
  cwd: string = process.cwd(),
  options: { readonly quiet?: boolean; readonly json?: boolean } = {},
): Promise<number> {
  const report = await gatherStatus(cwd);

  // `--json` for the reader that is not a person. The init skill tells an agent to
  // run this FIRST, and until now the answer came back as English — so any wording
  // change was a silent behaviour change for every agent downstream.
  console.log(options.json === true ? JSON.stringify(statusEnvelope(report), null, 2) : renderStatusReport(report, options));
  return report.ready ? 0 : 1;
}
