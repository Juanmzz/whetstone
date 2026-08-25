---
id: token-economy
version: 1
status: active
---
# Token economy

Keep context lean across sessions and sub-agent delegations. Every rule trades tokens for the
same outcome.

## Rules

1. [T1] Each config file stays small (~200 lines max). No content duplicated across files; if
   it's needed in two places, put it in one and reference it by name.
2. [T2] Sub-agent prompts follow [[delegation]] D7 (task scope, artifact refs by id/path,
   rule-file paths, save instruction). Token-economy addition: the sub-agent fetches
   referenced content itself. Never inline it or forward session history.
3. [T3] Pass skill file paths to sub-agents, not skill content. They read the files
   themselves, so author intent is preserved and it survives compaction (each delegation can
   re-read).
4. [T4] Prefer the memory substrate's `save` over scattering ad-hoc `.md` artifacts. Fewer
   files = fewer tokens on every future read. Write a file only when the user asks or team
   sharing needs it.
5. [T5] Read the skill registry once per session (or at first delegation) and cache
   name/trigger/scope/path. Do not re-read it per delegation. If a lookup misses, re-read once
   and re-cache.
6. [T6] Apply the delegation triggers (see [[delegation]]) BEFORE inline context piles up.
   don't read/write your way into a bloated window and delegate as an afterthought.
7. [T7] Emitted agent-config (`CLAUDE.md` / `AGENTS.md`) is stitched from the `.wst/` source
   by the emitter. Do not paste raw source into it. Conditionally-relevant rules belong in
   skills, which lazy-load on demand, NOT in the always-on config.
8. [T8] Never forward accumulated orchestrator session context to a sub-agent (see T2). Fresh
   means fresh.
9. [T9] If a file was read this session, don't read it again unless it may have changed
   (after a write, a pull, or a sub-agent run). Ask first: "did I already read this? did it
   change?"
10. [T10] Route the model to the task: cheaper models for mechanical phases, stronger models
    for architecture and adversarial review. Follow the project's routing table; don't
    default everything to the most expensive tier.

## Changelog

- v1 (2026-07-09, init): generated from a mature workspace's token-economy skill. Stripped
  its host-specifics (its memory-observation calls, `skill_resolution` fallbacks, the host
  orchestrator/delegation-harness skill names, plugin-overlay stitching, haiku/sonnet/opus
  tiers). Kept rules T1–T10 and their IDs. Generalized: engram → "memory substrate"
  (`adr-0001`), overlay stitching → emitter
  (`adr-0002`), delegation-harness → the [[delegation]]
  skill. No signal receipts yet. Reformatted to SPEC §3.3: consolidated T1–T10 from
  individual H2 headings into a single `## Rules` numbered list. Removed the leaked
  "overlay" mechanic from T1 ("config/overlay file" → "config file"). Shortened T2, which
  restated [[delegation]] D7 near-verbatim (violating T1's no-duplication rule), to reference
  D7 plus only the token-economy-specific addition.
