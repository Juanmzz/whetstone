/**
 * A file in `src/commands/` exports one thing: its `run*` function.
 *
 * `docs/architecture.md` calls `commands/` "composition roots: build adapters, call
 * core, print", and says in the same breath that policy has a home in `core/`
 * "instead of accreting in `commands/`, which nothing guards". This is the guard.
 * A second export is the seam an adapter or a policy slips through, and every one
 * of them here was reached for by a test rather than by another command.
 *
 * A TYPE export is not that seam and does not count. An `interface CheckOptions`
 * is the command's own signature, erased at compile time and reachable as nothing;
 * `cli.ts` reads it to type its own flags. Counting them reported nine files where
 * four have a problem, and a check that is wrong five times out of nine is one
 * people learn to skip past.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = join("src", "commands");

interface Exported {
  readonly name: string;
  /** Erased at compile time, so it cannot be a behaviour anyone reaches for. */
  readonly type: boolean;
}

const TYPE_KINDS = new Set(["interface", "type"]);

const DECLARATION =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(class|interface|type|enum|function|const|let|var)\s+\*?\s*([A-Za-z_$][\w$]*)/;

/** Top-level exports only: everything in this directory declares at column zero. */
function exportsOf(source: string): Exported[] {
  const found: Exported[] = [];
  for (const line of source.split("\n")) {
    if (!line.startsWith("export")) continue;

    if (/^export\s+default\b/.test(line)) {
      found.push({ name: "default", type: false });
      continue;
    }
    if (/^export\s+\*/.test(line)) {
      found.push({ name: "*", type: false });
      continue;
    }
    const listed = /^export\s+(type\s+)?\{([^}]*)\}/.exec(line);
    if (listed !== null) {
      for (const part of (listed[2] ?? "").split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
        if (name !== undefined && name !== "") {
          found.push({ name, type: listed[1] !== undefined || /^type\s/.test(part.trim()) });
        }
      }
      continue;
    }
    const declared = DECLARATION.exec(line);
    if (declared !== null) {
      found.push({ name: declared[2] ?? "", type: TYPE_KINDS.has(declared[1] ?? "") });
    }
  }
  return found;
}

interface Drift {
  readonly file: string;
  readonly surface: readonly Exported[];
  readonly why: string;
}

function judge(file: string, surface: readonly Exported[]): Drift | null {
  const behaviour = surface.filter((e) => !e.type);
  if (behaviour.length === 0) return { file, surface: behaviour, why: "exports no command" };
  if (behaviour.length > 1) {
    return { file, surface: behaviour, why: `exports ${String(behaviour.length)} things, not one` };
  }
  const only = behaviour[0];
  if (only === undefined || !only.name.startsWith("run")) {
    return { file, surface: behaviour, why: `its one export is not a \`run*\` function` };
  }
  return null;
}

async function main(): Promise<void> {
  const names = (await readdir(DIR)).filter(
    (n) => n.endsWith(".ts") && !n.endsWith(".test.ts"),
  );
  names.sort();

  const drifted: Drift[] = [];
  for (const name of names) {
    const file = join(DIR, name);
    const drift = judge(file, exportsOf(await readFile(file, "utf-8")));
    if (drift !== null) drifted.push(drift);
  }

  if (names.length === 0) {
    console.error(`${DIR}: no command files found — nothing was verified`);
    process.exit(1);
  }

  if (drifted.length === 0) {
    console.error(
      `${String(names.length)} command files each export one \`run*\` function and nothing else`,
    );
    return;
  }

  console.error(`${DIR}: a composition root exports more than its command.\n`);
  for (const d of drifted) {
    console.error(`  ${d.file}: ${d.why}`);
    for (const e of d.surface) {
      console.error(`      ${e.type ? "type " : "     "}${e.name}`);
    }
  }
  console.error(
    `\n${String(drifted.length)} of ${String(names.length)} files. Types are not counted: they are the command's own signature.`,
  );
  console.error(`Move an adapter to \`src/shell/\` and policy to \`src/core/\`.`);
  process.exit(1);
}

await main();
