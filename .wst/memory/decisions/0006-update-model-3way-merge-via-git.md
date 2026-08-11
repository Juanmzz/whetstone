---
id: adr-0006
ts: 2026-07-13
status: accepted
supersedes: null
rules_affected: []
---
# Update model: 3-way merge against a recorded base, via git primitives — not a dependency

## Context

Whetstone COPIES skills into each project and EMITS config; both then drift from upstream two
ways: the project's retro amends its local copies from local signals, and upstream Whetstone
releases new versions. Without an update model, a bootstrapped project either freezes at its
init version or loses local amendments on any re-copy. This is the "vendored config with local
modifications" problem. A survey of comparable tools (copier, cruft, cookiecutter, projen,
create-react-app eject, ESLint shareable configs, Yeoman, git subtree/submodule, Terraform
modules) was run to pick the right model under Whetstone's constraints: files-first, git-native,
zero runtime deps in the target repo, self-contained payload, human-gated writes.

## Decision

- **Adopt copier/cruft's "3-way merge against a recorded base" model — implemented with git's own
  `git merge-file`, NOT by importing copier's Python engine.** Git is already assumed
  (git-native), so this is zero *additional* dependency. Reference/extends models (ESLint,
  Terraform, submodules) are rejected: they require a live dependency in the target repo and break
  the self-contained-payload thesis (ADR-0002). Eject (one-way copy) and cookiecutter (no update)
  are the anti-models.
- **Add the missing provenance pointer.** Skill front-matter (`version` + `## Changelog`) already
  matches copier's `.copier-answers.yml`; it needs one field in `wst.yaml` per skill:
  `vendored_from` — the upstream version the local copy was last synced from = the 3-way-merge
  BASE. Whetstone's skills are static markdown (no Jinja), so the "render" step is a no-op — simpler
  than copier. `vendored_from` is machinery-owned, never hand-edited (same invariant class as
  `signals.jsonl` append-only).
- **Two asset tiers, two treatments — do NOT conflate them:**
  - Skills / `triage-rules.md` (hand-editable) → 3-way merge (base=`@vendored_from`, mine=working
    tree, theirs=`@latest`), conflicts as inline git markers, human-gated per ADR-0003.
  - `CLAUDE.md` / `AGENTS.md` / `.claude/**` (emitter output, ADR-0002/0005) → projen model: never
    merge, RECOMPILE from `.sdd/`; a hand-edit found in the output is drift to flag, not content to
    reconcile.
- **`constitution.md` is on a never-auto-touch skip list** (SPEC §3.1 already says the retro never
  touches it); an update reports "upstream changed, review manually" at most.

## Consequences

- **Validates the "same machinery, three directions" thesis literally.** retro (theirs=nothing
  upstream), update (theirs=new upstream), contribution (offer mine as a patch against base) are
  the same `merge-file` call; only which side is authoritative at the human gate differs. The
  `version` + `vendored_from` pointer is the single piece of state that makes all three one code
  path. TD6's upstream contribution (Retro 0002, this session) was the first real exercise of the
  contribution direction — done by hand; this ADR is the model that automates it.
- The updater is V1+ engineering; it raises in priority because without it the tool is not usable
  over time (a project bootstrapped at v0.1 cannot get v0.2's hook emitter without a manual re-run).
- Open follow-ups: (1) a minimal `migrations:` note in a skill's Changelog for structural changes
  (rename/split/merge) that break path-based merge; (2) a read-only `wst check` ("are we behind
  upstream") separate from the merge. Both deferred, tracked here.
- Reversal condition: if 3-way merge on prose skills produces conflicts too often to be worth the
  machinery, fall back to "report drift + let the human re-copy manually" (cruft's `skip` taken to
  its limit) — but only after real update cycles show the merge failing, not before.
