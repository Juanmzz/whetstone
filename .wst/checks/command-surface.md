---
id: command-surface
description: A file in src/commands/ exports one thing, its run* function.
kind: deterministic
severity: block
tiers: [strict, light]
include:
  - "src/commands/**/*.ts"
command: npm run check:command-surface
origin: [adr-0008, adr-0037]
version: 1
---

`docs/architecture.md` defines `commands/` as "composition roots: build adapters, call
core, print", and says in the same breath that policy has a home in `core/` "instead of
accreting in `commands/`, **which nothing guards**". Both halves were true. `core/` has
`test/architecture.test.ts` holding the import direction; `commands/` had nothing at all,
and it accreted.

`gate.ts` reached 482 lines holding two `ReceiptStore` implementations. A `ReceiptStore`
reads and writes `.wst/receipts/`, which makes it an adapter, and adapters live in
`src/shell/`. Neither was reachable from another command; the export existed so a test
could get at it. That is the shape this catches: an extra export is where a thing that
belongs in another layer stops looking like a mistake.

**What it enforces.** Exactly one top-level export of BEHAVIOUR per file, a function whose
name starts with `run`. It reads `export` at column zero, which is how every declaration in
this directory is written; it is a text scan, not a type checker.

**A type does not count.** `interface CheckOptions` is the command's own signature: erased at
compile time, reachable as nothing, and read by `cli.ts` to type its own flags. Counting them
reported nine files where four have a problem, and a check that is wrong five times out of
nine is one people learn to skip past.

**It blocks, and it earned that by being green.** It arrived at `warn` over four failing
files, each with a destination: `createCheckRunner` and the two process adapters around it to
`shell/check-runner.ts`, `init.ts`'s repo reading to `shell/repo-facts.ts` and its payload
reading to `shell/payload.ts`, `signal.ts`'s two defaults to `core/signals/human.ts` beside
the scale they belong to, and `gatherStatus` with the whole of `status.ts`'s reading to
`shell/status.ts`. All eleven files pass now. A deterministic check over a line that holds may
block freely; the reason it waited was that it was red, not that it was uncertain.

**When it fails:** move the export, do not delete it. An adapter goes to `src/shell/`,
policy goes to `src/core/` where a test can reach it, and a helper only one command uses
stops being exported.
