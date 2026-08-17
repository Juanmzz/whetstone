---
id: provenance
description: No file rests on a decision that has been superseded. Derived from the edges the definition layer already declares.
kind: deterministic
severity: block
tiers: [strict, light]
include:
  - ".wst/checks/**"
  - ".wst/skills/**"
  - ".wst/memory/decisions.md"
  - ".wst/memory/signals.jsonl"
command: npm run check:provenance
origin: [adr-0001, adr-0019]
version: 1
---

Whetstone's central claim about itself is that every rule here was earned by something
that went wrong. The evidence is a set of edges spread across four kinds of file: a
signal names the rule it implicates, a check names the decision it rests on, a decision
names the one it supersedes. Nothing read two of them together, so nothing noticed when
they stopped agreeing — and one pair had.

**Derived, never stored.** adr-0001 refused the memory product: no embeddings, no
database, no index. That ruling is about *storing* a graph. This parses files the gate
already reads, holds the result for one process, and writes nothing. If the derivation
ever disagrees with the files, the files win.

**One rule, deliberately.** A check's `origin:` is a declared field with a single
meaning, so "it names a superseded decision" is a fact. A tempting second rule — a skill
citing a signal that does not cite it back — was written, measured and removed: run
against this repo it reported eight problems and exactly one was real. `lazy.md` cites
five signals as EXAMPLES of the pattern its rule describes, and `tdd-discipline.md`
cites two ids from another repo's log, saying so in the same sentence. A check that is
red for the wrong reason gets routed around, and then it stops catching the right one.

What would make that second rule checkable is a way for a skill to mark which of its
citations are provenance. That is a change to how rules are written, so it belongs to a
retro and a human.

**What it does not check:** whether a rule deserves to exist, or whether a signal was
worth recording. Both are judgment. Whether `skill-shape` still rests on a decision that
was retired is a fact.

**When it fails:** repoint `origin:` at the decision that supersedes the old one, or at
the one that actually governs the check now. It caught its own first case that way —
`skill-shape` cited adr-0007, superseded by adr-0019.

Deterministic checks may block freely (constitution non-negotiable 7).
