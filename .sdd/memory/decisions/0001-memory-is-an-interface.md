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
