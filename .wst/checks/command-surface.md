---
id: command-surface
description: A file in src/commands/ exports one thing, its run* function.
kind: deterministic
severity: warn
tiers: [strict, light]
include:
  - "src/commands/**/*.ts"
command: npm run check:command-surface
origin: [adr-0008]
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

**What it enforces.** Exactly one top-level export per file, a function whose name starts
with `run`. It reads `export` at column zero, which is how every declaration in this
directory is written; it is a text scan, not a type checker.

**Why `warn` and not `block`.** Nine of the eleven files fail it today and two of the
failures are out of scope by design (`init.ts` is 683 lines and its own change). A check
that is red on arrival and cannot be made green gets routed around. It reports the debt
until someone has paid it down, and promoting it to `block` is a human's signature on a
line that will hold.

**The open question it does not answer.** Eight of the extra exports are `interface
*Options` types, erased at compile time, which nobody can reach for as behaviour. Whether
a type export counts against this rule is a decision, so the check counts them and prints
which ones they are rather than quietly picking a side.

**When it fails:** move the export, do not delete it. An adapter goes to `src/shell/`,
policy goes to `src/core/` where a test can reach it, and a helper only one command uses
stops being exported.
