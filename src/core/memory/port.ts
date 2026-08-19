/**
 * The memory interface. PURE — a type, and nothing that touches a disk.
 *
 * Non-negotiable 2 says memory is an interface and nothing may hard-depend on a
 * backend, engram included. Until now there was no interface: four call sites
 * reached into `.wst/memory/signals.jsonl` through two different readers, and
 * `wst.yaml`'s `backend:` key selected among implementations of nothing.
 *
 * TWO VERBS, NOT THREE. adr-0015 names the trap this avoids — *"declare three
 * verbs, implement two, and let `summarize` throw"*. `save` and `all` each have
 * live callers today. `search` does not, so it is absent; it arrives with the
 * consumer that needs it, which is cross-project recall, the one thing a file
 * genuinely cannot serve.
 */

import type { SignalRecord } from "../signals/parse.js";

export interface MemoryPort {
  /**
   * Everything recorded, oldest first.
   *
   * THROWS on a corrupt store rather than returning a subset. Reasoning over
   * part of the log while reporting it read all of it is how a retro cites
   * evidence nobody wrote, and how the gate re-emits signals it already holds.
   */
  all(): Promise<readonly SignalRecord[]>;

  /** Append observations. Returns the ids written, in order. */
  save(records: readonly SignalRecord[]): Promise<readonly string[]>;
}
