---
id: adr-0001
ts: 2026-07-02
status: accepted
supersedes: null
rules_affected: []
---
# Memory is an interface, not a product

## Context

An early question was whether Whetstone should ship its *own* engram-like memory
(structured store, semantic search) or let each user *plug in* whatever memory they already
have (engram or another). Framed as an either/or, it is a false dilemma — and the "build our
own memory engine" branch is the project's biggest scope trap. A real engram-equivalent
(embeddings, a DB, indexing) is a whole separate product; pursuing it would risk shipping
neither the memory engine nor the retro loop that is the actual thesis.

## Decision

Memory is an **interface**, not a product. The core depends only on three methods:
`save(record)`, `search(query, opts)`, `summarize(scope)` (SPEC §2.3).

- The **default backend is plain files** in `.sdd/memory/` (`signals.jsonl`, `decisions/`),
  versioned in git. This is the reference implementation and the source of truth.
- The **core must be fully functional with the file backend alone.** Engram, sqlite+FTS5,
  or any MCP memory server are **optional adapters** behind the same contract.
- Semantic search / embeddings are **explicitly deferred** (not before M3 ships).
- We do **not** fork or hard-depend on engram.

M1 memory = files + grep. That is enough to feed and prove the retro loop.

## Consequences

- The retro loop only ever talks to `save` / `search` / `summarize`, so a backend can be
  swapped (grep → sqlite → engram) **without touching the loop**.
- Because files remain the source of truth, switching backends never loses data — any index
  is a regenerable cache (see `.gitignore`).
- No external dependency is required to run or evaluate Whetstone.
- "Own memory" and "pluggable memory" both hold: the file substrate *is* the built-in
  memory, and the adapter interface *is* the plug.

## Amendment (2026-07-11) — `summarize` is core-owned; `save`/`search` validated

A survey of four real backends (Basic Memory, mem0, Letta, the reference MCP `memory` server)
against the three-method contract refined — did not reverse — this decision:

- **`save` and `search` are validated as the right shape.** Every backend surveyed has an
  unambiguous save primitive and a query primitive with at least partial structured filtering
  (3 of 4 support real date-range filters mapping onto `opts.{type,phase,since,rule}`).
- **`summarize` is the outlier: not one backend exposes prose synthesis as a first-class
  call.** So `summarize` can never be a thin per-adapter passthrough. **Decision:** implement
  `summarize(scope)` **once in the core** as `render(search(scope))` with a default markdown
  template; adapters override it only if they own native synthesis (none do today). The
  interface still holds at the call-site — skills/loop only ever call the three — but the
  contract is asymmetric: `save`/`search` are adapter-owned, `summarize` is core-owned and
  optional to override. SPEC §2.3 should say this explicitly.
- **First adapter after files = Basic Memory** — same substrate (markdown + frontmatter), no
  LLM rewrite of stored text (mem0 mutates by default), genuine structured filtering, no forced
  foreign concept. mem0 second (only with `infer=False`). Letta (stateful-agent tax) and the
  reference graph server (no time axis → `since` impossible) are deprioritized.
- Minor: `type` (signal/decision/pattern) is first-class in none of the file/vector backends;
  every adapter needs a small `type → tag/frontmatter-key` shim. Not a contract problem.
