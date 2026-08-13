---
id: adr-0014
ts: 2026-08-12
status: accepted
supersedes: null
rules_affected: []
---
# Split `wst run`: keep the briefing, drop the dispatcher

## Context

ADR-0011's second move says *"Remove `wst run` once the log exists, and delegate
dispatch to whatever the user already runs."* The log exists. Executing that sentence
literally deletes four things at once, and they are not the same kind of thing.

Measured, on this repo:

| | lines | what it is |
|---|---|---|
| `src/commands/run.ts` | 258 | lease → branch → charter → dispatch → gate → report → release |
| `src/core/dispatch/charter.ts` | 250 (+301 test) | builds the crewmate's briefing from the LIVE registry |
| `src/shell/crewmate.ts` | 105 | spawn `claude`, feed the charter, wait out a 30-minute timeout |
| `src/shell/treehouse.ts` | 55 | `treehouse get --lease` / `treehouse return` |

ADR-0011's argument for removal was that **worktree dispatch is commoditised** — Vibe
Kanban, container-use, Conductor, firstmate, and Claude Code's own native worktrees.
That argument is about `crewmate.ts`. It is not about `charter.ts`, and ADR-0011 did
not separate them.

**What survives without `wst run`, verified rather than assumed.** The concern was
losing the gate on a crewmate's work. It is not lost:

```
core.hooksPath              → .githooks
extensions.worktreeConfig   → (none)
```

Without `extensions.worktreeConfig`, git config is SHARED across worktrees. A crewmate
pushing from a leased worktree fires the same `pre-push` gate the orchestrator does,
and CI runs the full gate on the PR. `--no-receipts` — the "do not trust the worker's
cache" path — is a flag on `wst gate`, reachable by anyone. The merge authority
ADR-0011 wants Whetstone to be does not depend on this command.

**What does not survive.** The charter, and the automatic `release()`.

The charter is the one piece no generic harness supplies: it renders *"## What will
gate your work"* from the registry and triage rules **as they are right now**, so it
cannot go stale the way a hand-written prompt does. `sig-0041` is the incident — the
charter used to hardcode `AGENTS.md` and `.wst/architecture.md`, neither of which
`init --definitions-only` writes, so the first install into a foreign repo ordered an
agent to read two files that were not there.

**The worktree accumulation is real and already happening.** `run.ts:255`:

```
// Released ONLY on the clean path — every failure branch sets keepForInspection.
```

Every failed dispatch retains its lease on purpose, and nothing reaps them. One
worktree has been held in detached HEAD since 2026-08-09. Measured cost per worktree
is 2.5 MB, not 95, because treehouse symlinks `node_modules` back to the main
checkout — but the count is what grows, and with a POOL the failure mode is "no free
slots", which is loud and bounded. A worktree created per task fails silently instead.

### Alternatives weighed

- **Execute ADR-0011 literally: delete all four.** Rejected. It discards the charter
  along with the dispatcher on an argument that only applies to the dispatcher, and
  `sig-0041` shows the generated briefing catches errors a hand-written one does not.
- **Keep `wst run` whole.** Rejected. The dispatcher is ~105 lines of process
  babysitting behind a 30-minute timeout that emits nothing for its duration — the
  exact deficiency ADR-0011 was written about — and it is the half with an expiry
  date.
- **Keep it and add `wst clean` to reap worktrees.** Rejected: it trades one
  responsibility for another and keeps the dispatcher. The pool already bounds the
  count; the reaping belongs to whoever holds the lease.
- **Rename only, change nothing.** Rejected as cosmetic. The problem is not the name.

## Decision

We will **split** the command rather than remove it.

`wst run` becomes **`wst prepare <task>`**: lease a worktree, branch it, build the
charter from the live registry and triage rules, write it into the worktree, print the
path, and stop. It dispatches nothing and waits for nothing.

We will delete `src/shell/crewmate.ts` and the dispatch, wait, inline-gate and
`keepForInspection` half of `src/commands/run.ts`. We will keep
`src/core/dispatch/charter.ts` and `src/shell/treehouse.ts`.

**The lease becomes the human's from minute zero.** Whetstone stops owning the
worktree lifecycle; `treehouse return` is a command the person who knows whether the
work is finished runs. That is not a gap left open — it is the reason the automatic
`release()` can go without replacement.

This **amends** ADR-0011's second move; it does not supersede ADR-0011. That decision's
reasoning — dispatch is commoditised, the differentiator is the gate — is what this
executes. It only separates *dispatch* from *briefing*, which ADR-0011 did not.

**The tradeoff accepted, stated bluntly:** this deletes about 230 lines of
implementation, not the ~970 that removing the command outright would. Keeping the
charter costs roughly half the shrinkage ADR-0011 promised, and it is only worth it if
the generated briefing is actually used. If it is not piped into anything within a
reasonable trial, it is 551 lines with no users, and the same argument this project
applies to `wst pr` and to `init` applies to it.

## Consequences

**Easier.** Whetstone stops having an opinion about worktrees, which is the part of
this space with the shortest half-life. The command becomes honest about what it does:
it prepares, and preparing is the thing that finishes.

**Harder, and this is the real cost.** There is no longer an automatic gate on a
crewmate's result. Enforcement moves entirely to the push — and **a crewmate that
never pushes is never gated.** Today the command blocks for thirty minutes and gates
what comes back; after this, work that is abandoned in a worktree is work nobody
checked. That is acceptable only because abandoned work does not land, and landing is
what the gate guards.

**Unowned, and named so it is not discovered later.** `createDistrustfulReceiptStore`
was exported specifically so `wst run` and `wst gate` could not drift on what "do not
trust the worker's cache" means. With `run` no longer gating, its only consumer is the
`--no-receipts` flag. It stays, and its comment should stop citing a caller that no
longer exists.

**What reverses this.** If crewmates routinely produce work that never reaches a push,
the inline gate was doing something real and this should come back rather than be
patched around. The signal to watch is worktrees returned with commits that were never
pushed.
