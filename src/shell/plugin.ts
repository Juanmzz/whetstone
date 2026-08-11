/**
 * Harness-plugin adapter. THIN: it asks the harness what it has installed and hands
 * back one of four words. Every decision about what those words MEAN lives in
 * `core/status/report.ts`.
 *
 * `claude plugin list --json` is used rather than reading `~/.claude/plugins/*.json`
 * directly. Both would answer today; only one is a surface the harness maintains, and
 * status reporting a wrong answer confidently is the exact failure it exists to fix.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginInstall } from "../core/status/report.js";

const run = promisify(execFile);

/** The plugin's name in the harness. Marketplace-independent: ids are `name@market`. */
export const PLUGIN_NAME = "whetstone";

export async function describePlugin(): Promise<PluginInstall> {
  let stdout: string;
  try {
    ({ stdout } = await run("claude", ["plugin", "list", "--json"], { timeout: 15_000 }));
  } catch {
    // No `claude` on PATH, or a build without the subcommand. "absent" would be a
    // claim we did not verify; status has a word for not knowing.
    return "unknown";
  }

  let rows: unknown;
  try {
    rows = JSON.parse(stdout);
  } catch {
    return "unknown";
  }
  if (!Array.isArray(rows)) return "unknown";

  const mine = rows.find(
    (row): row is { readonly id: string; readonly enabled?: unknown } =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as { id?: unknown }).id === "string" &&
      (row as { id: string }).id.split("@")[0] === PLUGIN_NAME,
  );

  if (mine === undefined) return "absent";
  return mine.enabled === true ? "enabled" : "disabled";
}
