---
id: docs-fresh
description: The counts in AGENTS.md's status block match the repo — decisions, signals, registered commands.
kind: deterministic
severity: block
tiers: [strict, light]
include:
  - "AGENTS.md"
  - "src/cli.ts"
  - ".wst/memory/decisions.md"
  - ".wst/memory/signals.jsonl"
command: npm run check:docs
origin: [adr-0002, adr-0017, adr-0019]
version: 3
---

`AGENTS.md` carries a warning saying it has gone stale four times, calls the drift
structural rather than careless — and then went stale a fifth time, claiming 581 tests
and branch `engine-skeleton` while `main` had 884 and eight more ADRs. A warning about
staleness is not a defence against it.

**What it counts, and why only these three.** `### adr-NNNN` anchors in
`.wst/memory/decisions.md`, non-blank lines in the signal log, and `.command(`
registrations in `src/cli.ts`. Each is one cheap file operation with exactly one right
answer. The test count is deliberately NOT in the status block: verifying it means
running the suite a second time inside a gate that already runs it, and it is the
number that changes most and tells you least.

**Why it triggers on `src/cli.ts`, the decisions page and the signal log,** not just on
`AGENTS.md`: the failure mode is not editing the status block wrong. It is adding a
command, a decision or a signal and leaving the block behind. The check has to fire on
the change that made the claim false, not on the change that admits it.

The signal log was missing from that list for as long as the argument above has been
written down, and it is the counted file that changes most: appending a signal made the
block false and fired nothing, so the failure surfaced later, on an unrelated change
that had not caused it. That happened twice on 2026-08-14 — once from this gate's own
emitter, which appended `sig-a9ff00c4` and left the count it invalidated behind.
`test/docs-fresh.test.ts` now fails if any counted source drops out of `include`.

**v2:** the signal log joined `include`. **v3 (adr-0019):** decisions stopped being
files in a directory, so the count became a count of `### adr-NNNN` anchors on one page
and the glob became that page. `adr-refs` is what keeps those anchors well-formed and
unique.

It caught an error on its first run — a hand-written "11 commands" against 10
registrations, because `--help` lists `help` and the registry does not.

**When it fails:** update the status line. Every number in it is one command away, and
the failure message prints both the claim and the reality.

Deterministic checks may block freely (constitution non-negotiable 7). Every rule here
compares a number in a file to a number the filesystem already knows.
