/**
 * `.wst/wst.yaml` as a validated shape. PURE.
 *
 * The file was written by `init` and read by nothing, so `backend: files |
 * engram | ...` selected among implementations of a port that does not exist,
 * and `architecture.md` claimed an `agent:` key that was never anywhere. A
 * config key with no reader is worse than its absence: someone changes it and
 * expects an effect.
 */

import { z } from "zod";

/**
 * Which adapter runs `llm` checks.
 *
 * Each has its own adapter and its own measured invocation: none of `claude -p`'s
 * flags transfer, and Gemini takes no schema flag at all. Each also earns its own
 * calibration, since a receipt binds the model. They report side by side and never
 * vote (adr-0026).
 */
export const AGENTS = ["claude", "gemini"] as const;
export type Agent = (typeof AGENTS)[number];

/**
 * Where memory lives. `files` only, until a port exists to select against.
 * Non-negotiable 1 is "the file backend alone"; anything else stays optional.
 */
export const BACKENDS = ["files"] as const;
export type Backend = (typeof BACKENDS)[number];

export const ConfigSchema = z.object({
  agent: z.enum(AGENTS).default("claude"),
  backend: z.enum(BACKENDS).default("files"),
});

export type WstConfig = z.infer<typeof ConfigSchema>;

/** For a repo with no `wst.yaml`, which is every repo until `init` writes one. */
export const DEFAULT_CONFIG: WstConfig = Object.freeze({ agent: "claude", backend: "files" });

/**
 * What the file declares, defaults for what it omits.
 *
 * A value outside the enum THROWS rather than falling back. `agent: gemini`
 * silently running claude is the failure this key exists to prevent, and it
 * would be invisible: the run succeeds and the verdict looks normal.
 */
export function parseConfig(raw: unknown): WstConfig {
  if (raw === null || raw === undefined) return DEFAULT_CONFIG;
  const parsed = ConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];
  const at = issue?.path.join(".");
  throw new Error(
    `wst.yaml: ${at === undefined || at === "" ? "config" : at} — ${issue?.message ?? "invalid"}`,
  );
}
