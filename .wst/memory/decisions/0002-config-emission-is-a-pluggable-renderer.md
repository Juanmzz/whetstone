---
id: adr-0002
ts: 2026-07-06
status: accepted
supersedes: null
rules_affected: []
---
# Config emission is a pluggable renderer; `.sdd/` is the source of truth

## Context

Coding agents do not share one native config file. Each CLI reads its own: Claude Code
reads `CLAUDE.md`, Cursor reads `.cursor/rules/`, Copilot reads
`.github/copilot-instructions.md`. A prior-art check (2026-07-06) found that `AGENTS.md`
has become a broadly adopted cross-vendor standard — native in 28+ tools including Claude
Code (since spring 2026), present in ~60k repos — though Claude Code still prefers
`CLAUDE.md` for its own config.

ChytaPay's `scripts/bootstrap.mjs` already stitches overlays + skills into
`~/.claude/CLAUDE.md`, and a SessionStart hook injects the project context. That is an
emitter — but mono-vendor (Claude only). Whetstone generalizes it.

## Decision

The `.sdd/` directory is the **canonical, vendor-neutral source of truth**. Vendor-native
files are produced by **pluggable emitters** that render `.sdd/` into whatever a given CLI
reads. This is the same adapter philosophy as the memory backend ([[0001-memory-is-an-interface]]).

- V0 default emitter writes **both `CLAUDE.md` and `AGENTS.md`** — that pair covers the
  large majority of agents with minimal surface.
- Additional emitters (`.cursor/rules`, etc.) are optional, added behind the same seam.
- `.sdd/` is never derived FROM a vendor file; the vendor files are always outputs.

## Consequences

- Adding or swapping a target agent never touches `.sdd/` or the core.
- The cross-vendor problem is smaller than feared: `CLAUDE.md` + `AGENTS.md` is enough for V0.
- Upholds the "not tied to Claude Code" principle from VISION.md.
- Whetstone's emitter is a generalization of an emitter already proven in production
  (ChytaPay's `bootstrap.mjs`), not a net-new invention.
