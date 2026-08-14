---
id: docs-fresh
description: The counts in AGENTS.md's status block match the repo — ADRs, signals, registered commands.
kind: deterministic
severity: block
tiers: [strict, light]
include: ["AGENTS.md", "src/cli.ts", ".wst/memory/decisions/**/*.md"]
command: npm run check:docs
origin: [adr-0002]
version: 1
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

**Why it triggers on `src/cli.ts` and on the ADR directory,** not just on `AGENTS.md`:
the failure mode is not editing the status block wrong. It is adding a command or an
ADR and leaving the block behind. The check has to fire on the change that made the
claim false, not on the change that admits it.

It caught an error on its first run — a hand-written "11 commands" against 10
registrations, because `--help` lists `help` and the registry does not.

**When it fails:** update the status line. Every number in it is one command away, and
the failure message prints both the claim and the reality.

Deterministic checks may block freely (constitution non-negotiable 7). Every rule here
compares a number in a file to a number the filesystem already knows.
