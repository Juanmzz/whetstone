/**
 * The registry, as a page somebody reads. PURE.
 *
 * It printed a severity column, then repeated the same ids under `may block`.
 * In a repo where every check blocks, that is one fact stated nine times and
 * then summarised. What varies between rows is what the reader needs.
 */

import type { LoadedCheck } from "./registry.js";

/** A default terminal is eighty columns, and the row is indented and padded. */
const ROOM = 80;

export interface RegistryPage {
  readonly definitionDir: string;
  readonly checks: readonly LoadedCheck[];
}

function widthOf(checks: readonly LoadedCheck[]): number {
  return Math.max(...checks.map((c) => c.id.length), 4);
}

/** `det`, `llm`, `meth`. A method rendered as `det` reads as something the gate runs. */
const kindOf = (check: LoadedCheck): string =>
  check.kind === "llm" ? "llm " : check.kind === "method" ? "meth" : "det ";

const severityOf = (check: LoadedCheck): string =>
  !check.enabled ? "off  " : { block: "BLOCK", warn: "warn ", annotate: "note " }[check.severity];

export function renderRegistry(page: RegistryPage): readonly string[] {
  const { checks } = page;
  if (checks.length === 0) {
    return [`no checks registered: add files under ${page.definitionDir}/checks/<id>.md`];
  }

  const active = checks.filter((c) => c.enabled);
  const blocking = active.filter((c) => c.severity === "block");
  const lines: string[] = [
    `checks (${String(active.length)} active of ${String(checks.length)})`,
    "",
  ];

  const width = widthOf(checks);
  // What is left for the description after the indent, the two labels and the id.
  const room = ROOM - (2 + 6 + 6 + width + 1);

  for (const check of checks) {
    const said =
      check.description.length <= room ? check.description : `${check.description.slice(0, room - 1)}…`;
    lines.push(`  ${severityOf(check)} ${kindOf(check)}  ${check.id.padEnd(width)} ${said}`);
  }

  // Only where it says something the column above did not. All of them blocking
  // is what the column already showed nine times.
  if (blocking.length > 0 && blocking.length < active.length) {
    lines.push("", `  may block: ${blocking.map((c) => c.id).join(", ")}`);
  }

  return lines;
}
