---
id: adr-0010
ts: 2026-08-09
status: proposed
supersedes: null
rules_affected: []
---
# Distribute as a Claude Code plugin; move the strict-path hook out of the payload

## Context

Two problems that turn out to be one.

**Distribution.** Using `wst` today means cloning this repo, `npm run build`, `npm
link`. That is fine for the author and a wall for anyone else. The README already
names distribution as the last milestone — *"the payload is the value"* — and that
ordering is still right, but "last" was chosen when the only option imagined was
`npx wst`.

**The payload writes into `.claude/`.** `init` emits
`.claude/hooks/strict-path-guard.mjs` and `.claude/settings.json` into every target
repo. That is the single most dangerous thing it writes: `settings.json` is replaced
wholesale, so a repo's existing permissions, env, statusLine and other hooks are lost.
It is what forced `core/init/collisions.ts` into existence (sig-0029), it is why
ChytaPay needs `--no-code-tier` to coexist with its own plugin, and it means a hook
improvement has to be re-run through `init` in every bootstrapped repo to land.

The observation that joins them: a Claude Code plugin can ship binaries and hooks. If
the plugin provides the hook, `init` stops writing `.claude/` at all.

### What this is not

It is not making Whetstone a Claude Code tool. The engine is a plain CLI behind a
`LlmJudge` port (`core/ports.ts`) with a `claude` adapter; a second adapter is a new
file in `shell/`, not a rewrite. A plugin is a *distribution channel* for a binary
that runs anywhere — in CI, in a git hook, from any shell. ADR-0002 already frames
vendor files as pluggable renderer output; a plugin is one more render target.

### Alternatives weighed

- **`npx wst` only.** Simplest, and leaves the `.claude/` payload problem untouched —
  which is the half that actually hurts.
- **Publish to npm and keep emitting the hook.** Solves distribution, keeps the
  collision, keeps the update problem (a hook fix strands in every repo not re-inited).
- **Drop the strict-path hook entirely.** Tempting, since it only *warns* and the gate
  is the real channel (ADR-0009). Rejected: the warning arrives at the moment of the
  edit, which is the one moment the gate cannot reach.
- **Plugin only, no npm.** Rejected: it would make the binary unreachable from CI,
  which is where the gate matters most.

## Decision

We will publish `wst` to npm, and ship a Claude Code plugin that installs it and
provides the session-side layer.

The split:

| | Lives in | Responsibility |
|---|---|---|
| `wst` binary | npm | the engine. Runs in CI, in hooks, in any shell |
| strict-path hook, skills | the plugin | ergonomics inside a Claude Code session |
| `.sdd/` | the target repo | the definition. Source of truth, vendor-neutral |

`init` stops writing `.claude/` entirely. `--code-tier` becomes unnecessary and is
removed with it.

**Nor does it write CI.** Whetstone does not install a workflow into a repo it does not
own. In a brownfield repo the seeded checks are read from `package.json`, so they are the
same `lint`, `test` and `typecheck` the host's own CI already runs: a second workflow buys
a second name for one verification, and it reports at PR time, which is after the author
has moved on. In a host repo the gate's channel is the push. What Whetstone owes that repo
instead is an answer to whether the CI it already has covers what the gate requires,
reported by `wst status` alongside the other rows.

Whetstone's own repo keeps its workflow. It is its own product, it has no other CI, and it
has to self-gate somewhere that cannot be skipped.

The tradeoff accepted: a project that uses Whetstone WITHOUT Claude Code loses the
edit-time warning and keeps only the gate. That is the correct degradation — the gate
was already the only channel that does not depend on an agent cooperating (ADR-0009),
and a warning aimed at an agent belongs with the agent, not in the repo.

## Consequences

**Easier.** The payload shrinks and loses its most destructive write. Coexistence with
another Claude Code plugin becomes automatic rather than a flag. A hook fix reaches
every user by updating the plugin instead of re-running `init` in every repo. `wst`
becomes installable by a stranger.

**Harder.** Two artifacts to release in step, and a version skew to reason about: a
plugin newer than the binary, or the reverse. Neither exists today.

**What declining to write CI costs, stated plainly.** A gate that lives only in a pre-push
hook is an honour system. `--no-verify` skips it, and on 2026-08-10 it was skipped
deliberately, for sound reasons, by the people who wrote it. That weakens ADR-0009's claim
that the gate is "the only channel that does not depend on an agent cooperating": in a host
repo it now depends on nobody passing a flag. Accepted, because installing a workflow into
someone else's repository is a larger intrusion than the risk it removes, and because the
host's own CI is the right place for an un-bypassable check that the host already owns.
Reporting whether that CI is sufficient is the smaller apparatus, and the smaller apparatus
wins (`retro.ts:47`).

**Blocked on.** Nothing technically — but deliberately sequenced after the value is
demonstrated. Distributing a tool whose value is unproven recruits people into an
experiment. Ship this once a repo other than Whetstone has been gated long enough to
say whether the gate helps or annoys.

**What reverses this.** If the plugin format proves too confining — if the hook cannot
be provided without also claiming `settings.json` — fall back to npm-only and keep the
hook in the payload, with the collision guard doing its job.
