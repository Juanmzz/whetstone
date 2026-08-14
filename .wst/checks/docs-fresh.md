---
id: docs-fresh
description: The counts in AGENTS.md's status block match the repo — ADRs, signals, registered commands.
kind: deterministic
severity: block
tiers: [strict, light]
include:
  - "AGENTS.md"
  - "src/cli.ts"
  - ".wst/memory/decisions/**/*.md"
  - ".wst/memory/signals.jsonl"
command: npm run check:docs
origin: [adr-0002]
version: 2
---

`AGENTS.md` carries a warning saying it has gone stale four times, calls the drift
structural rather than careless — and then went stale a fifth time, claiming 581 tests
and branch `engine-skeleton` while `main` had 884 and eight more ADRs. A warning about
staleness is not a defence against it.

**What it counts, and why only these three.** ADRs on disk, non-blank lines in the
signal log, and `.command(` registrations in `src/cli.ts`. Each is one cheap file
operation with exactly one right answer. The test count is deliberately NOT in the
status block: verifying it means running the suite a second time inside a gate that
already runs it, and it is the number that changes most and tells you least.

**Why it triggers on `src/cli.ts`, the ADR directory and the signal log,** not just on
`AGENTS.md`: the failure mode is not editing the status block wrong. It is adding a
command, an ADR or a signal and leaving the block behind. The check has to fire on the
change that made the claim false, not on the change that admits it.

The signal log was missing from that list for as long as the argument above has been
written down, and it is the counted file that changes most: appending a signal made the
block false and fired nothing, so the failure surfaced later, on an unrelated change
that had not caused it. That happened twice on 2026-08-14 — once from this gate's own
emitter, which appended `sig-a9ff00c4` and left the count it invalidated behind.
`test/docs-fresh.test.ts` now fails if any counted source drops out of `include`.
Version bumped 1 → 2 so receipts minted against the narrower `include` are re-earned.

It caught an error on its first run — a hand-written "11 commands" against 10
registrations, because `--help` lists `help` and the registry does not.

**When it fails:** update the status line. Every number in it is one command away, and
the failure message prints both the claim and the reality.

Deterministic checks may block freely (constitution non-negotiable 7). Every rule here
compares a number in a file to a number the filesystem already knows.
