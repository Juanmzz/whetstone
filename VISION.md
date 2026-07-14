# Whetstone

**Self-sharpening workflows for coding agents.**

## Thesis

Agent workflows should improve with use — and leave an audit trail of why every rule exists.

Today, teams hand-craft workflow rules for coding agents (triage policies, delegation rules, TDD discipline, doc conventions). These rules are born from real signals, but the loop is manual: something goes wrong, a human notices, a human edits a prompt or skill file. Whetstone closes that loop.

## The problem

Spec-driven development tools (Spec Kit, BMAD, Superpowers) solve the *forward* path well: spec → plan → code, with human gates. None of them solve the *feedback* path:

- No project-level memory of decisions and signals that survives sessions and tools.
- No versioning of workflow rules — no diff, no changelog, no record of *why* a rule changed.
- No mechanism for the workflow to propose its own improvements based on what actually happened.

Every team that runs agents seriously ends up rebuilding this by hand, inside one tool, coupled to one memory backend.

## What Whetstone is

1. **An init wizard** that interviews a project (stack, risk profile, team size, conventions) and generates a `.sdd/` directory: a constitution, triage rules, and a starter set of workflow skills adapted to that project.
2. **A file-based memory substrate** that lives in the repo and travels with it:

```
.sdd/
  constitution.md          # project governance, generated at init
  triage-rules.md          # risk classification for changes
  memory/
    decisions/             # ADRs: one markdown file per decision
    signals.jsonl        # append-only structured signal log
    patterns.md            # distilled recurring patterns
  skills/                  # versioned workflow rules, each with a changelog
    delegation.md
    tdd-discipline.md
    doc-locations.md
```

3. **A retro loop** (`/retro`): reads accumulated signals and decisions since the last retro, detects patterns (e.g. "triage misclassified auth changes twice"), and **proposes diffs to the skill files**. A human approves; the skill is amended with a changelog entry linking back to the signals that motivated it.

The loop: **use → record → distill → amend**. That is the product.

## What Whetstone is NOT

- **Not another spec-driven framework.** It composes with Spec Kit, BMAD, Superpowers, or a bare CLAUDE.md. It owns the feedback loop, not the forward workflow.
- **Not a memory server.** Memory is an interface, not a product. The default backend is plain files in git. Engram, sqlite+embeddings, or any MCP memory server plug in as optional adapters behind the same contract: `save(record)`, `search(query)`, `summarize(scope)`.
- **Not autonomous self-modification.** Every amendment to a rule passes a human gate. The value is *auditable* evolution, not unsupervised drift.
- **Not tied to Claude Code.** Files-first design means any agent that reads markdown can consume it. Claude Code gets first-class support (plugin, slash commands, hooks).

## Design principles

1. **Git-native.** All state is plain text in the repo. Diffable, reviewable, portable. No required servers.
2. **Memory-agnostic.** File backend by default; everything else is an adapter.
3. **Human-in-the-loop.** The retro proposes; the human disposes.
4. **Rules carry receipts.** Every rule links to the signals and decisions that created it. Delete the reason, question the rule.
5. **Small core, composable edges.** The core is the `.sdd/` schema + the retro loop. Integrations (Claude Code plugin, Spec Kit extension, MCP adapters) live at the edges.

## Milestones

**M1 — Bootstrap (v0.1)**
Init wizard + `.sdd/` schema + generic versions of the initial skill set (delegation, TDD discipline, doc locations, token economy), extracted from a real production setup. Manual signal logging (`/log-signal` command). Publishable and demoable on its own.

**M2 — Code tier (v0.2)** ✅
The emitter compiles `.sdd/` into per-vendor apparatus — hooks first (a project-specific `strict-path-guard`, derived from `triage-rules.md`), then agents/commands, earned via the retro. NOT plugin packaging — distribution is deferred (see below), per ADR-0004/0005.

**M3 — The retro loop (v0.3)** ✅ (first pass)
`/retro`: pattern detection over `signals.jsonl` + `decisions/`, apparatus recommendation (amend a rule, or curate/generate a skill/hook/command), human approval flow, changelog with signal receipts. Validated in the wild — a real project's signals produced the first earned rule (TD6). Next: make it repeatable (N>1).

**M4 — Update model**
Keep bootstrapped projects current via 3-way merge against a recorded base (ADR-0006); contribute local amendments upstream — the same machinery in three directions.

**Later / explicitly deferred**
Distribution (`npx whetstone` CLI / optional Claude Code plugin) comes AFTER the loop is repeatable — Wizard-of-Oz → validate → wrap, never the reverse (ADR-0004/0005). Then: semantic search backend, multi-repo/org-level memory, non-Claude emitters. Not before the retro proves out.

## Contribution model

MIT license. The anti-scope section above is enforcement policy: PRs that turn Whetstone into a spec framework or a memory server will be redirected, kindly. Good first issues will target M1 skill genericization and `.sdd/` schema review.

## Origin

Extracted from a production workflow built for a fintech codebase (SDD orchestration, delegation harness, TDD discipline, token economy — all born from real signals). Whetstone is the generalization of that loop.
