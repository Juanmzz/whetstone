/**
 * Running a repo's own commands once, so a seeded severity is a measurement.
 *
 * Adapter only: it spawns, times, and reports an exit code. Whether a green run
 * earns a `block` is `core/init/probe.ts`'s call.
 *
 * READ-ONLY is not enforceable here. These are the repo's own scripts, and `init`
 * is about to write to the repo anyway; what it must not do is run something the
 * repo did not already declare. Every command comes from the manifest.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProbeResult, Probes } from "../core/init/probe.js";

const run = promisify(execFile);

/** Long enough for a real suite, short enough that `init` is not a place to wait. */
const TIMEOUT_MS = 180_000;

async function probeOne(command: string, cwd: string): Promise<ProbeResult> {
  const started = Date.now();
  try {
    await run(command, { cwd, shell: true, timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
    return { ran: true, ok: true, exitCode: 0, durationMs: Date.now() - started };
  } catch (cause) {
    const error = cause as { code?: number | string; killed?: boolean; signal?: string };
    // A timeout or a missing binary is the probe failing, not the command. Both
    // land at `warn`, and the reason says which.
    if (error.killed === true || typeof error.code === "string") {
      const why = error.killed === true ? `timed out after ${String(TIMEOUT_MS / 1000)}s` : String(error.code);
      return { ran: false, why };
    }
    return { ran: true, ok: false, exitCode: error.code ?? 1, durationMs: Date.now() - started };
  }
}

/**
 * The three declared commands, run in parallel. A command the repo does not
 * declare is absent rather than failed.
 */
export async function probeCommands(
  commands: Readonly<Record<string, string | null>>,
  cwd: string,
  onStart?: (id: string, command: string) => void,
): Promise<Probes> {
  const named = Object.entries(commands).filter(([, c]) => c !== null && c !== "");
  const results = await Promise.all(
    named.map(async ([id, command]) => {
      onStart?.(id, command as string);
      return [id, await probeOne(command as string, cwd)] as const;
    }),
  );
  return Object.fromEntries(results);
}
