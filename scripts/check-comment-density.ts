/** How much of what a change ADDS is comment. Rationale in the check file. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFINITION_DIR } from "../src/core/paths.js";

const exec = promisify(execFile);

const MAX_PERCENT = 25;

/** Below this, one comment on a three-line change reads as 33% and means nothing. */
const MIN_SAMPLE = 15;

const isComment = (line: string): boolean =>
  line.startsWith("//") || line.startsWith("*") || line.startsWith("/*");

async function main(): Promise<void> {
  const range = process.env["WST_GATE_RANGE"] ?? "HEAD";
  const { stdout } = await exec(
    "git",
    ["-c", "core.quotePath=false", "diff", "--unified=0", range, "--", "*.ts"],
    { maxBuffer: 32 * 1024 * 1024 },
  );

  let comment = 0;
  let code = 0;
  let removedComment = 0;
  for (const line of stdout.split("\n")) {
    const added = line.startsWith("+") && !line.startsWith("+++");
    const removed = line.startsWith("-") && !line.startsWith("---");
    if (!added && !removed) continue;
    const text = line.slice(1).trim();
    if (text === "") continue;
    if (removed) {
      if (isComment(text)) removedComment += 1;
      continue;
    }
    if (isComment(text)) comment += 1;
    else code += 1;
  }

  if (removedComment >= comment) {
    console.error(
      `comment density: ${String(comment)} added, ${String(removedComment)} removed over ${range} — net reduction`,
    );
    return;
  }

  const total = comment + code;
  if (total < MIN_SAMPLE) {
    console.error(`comment density: ${String(total)} added lines over ${range} — too few to judge`);
    return;
  }

  const percent = Math.round((100 * comment) / total);
  const verdict = `${String(percent)}% of ${String(total)} added .ts lines over ${range} are comment`;

  if (percent > MAX_PERCENT) {
    console.error(`${verdict}, over the ${String(MAX_PERCENT)}% ceiling.\n`);
    console.error(`Comments belong where the code cannot be made clear on its own.`);
    console.error(`History, rejected alternatives and what a module used to do go in the`);
    console.error(`commit body or in ${DEFINITION_DIR}/memory/decisions.md, not above the code.`);
    process.exit(1);
  }

  console.error(`${verdict} — under the ${String(MAX_PERCENT)}% ceiling`);
}

await main();
