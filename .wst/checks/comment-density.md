---
id: comment-density
description: A change adds more code than commentary about it.
kind: deterministic
severity: block
tiers: [strict, light]
include:
  - "src/**/*.ts"
  - "scripts/**/*.ts"
  - "test/**/*.ts"
command: npm run check:comments
skippable: false
origin: [sig-4a2610fb]
version: 1
---

The rule is that comments are brief and confined to what the code cannot say on its
own. It was stated twice, applied by hand once — `src/` went from 36% comment to 30% —
and was back at 33% two days later on a branch written by the same person who applied
it. Nothing held it. That is `sig-4a2610fb`.

**Why it reads the diff and not the tree.** Every other check here measures the whole
checkout. One branch at 33% moves a repo average by a tenth of a point and passes, so
the rule this enforces is not expressible that way. It is the first check to use
`WST_GATE_RANGE`, and the reason that variable exists.

**The ceiling is measured, not chosen.** Over 30 commits of `main` the share of added
`.ts` lines that are comment runs 19, 20, 21, 22, 29, 30, 39, 39, 47. Twenty-five sits
in the gap. At that ceiling five of the eleven judgeable commits in the last
twenty-five would have blocked, and those five are the ones the signal is about.
Raising it is a decision to make in this file, where the next reader can see it.

**Why no receipt may stand in for it.** A receipt proves "this check passed on these
file contents", which is evidence only for a check whose answer is a function of those
contents. This one reads `WST_GATE_RANGE`, so it answers a different question per
range, and the range is not in the hash. `skippable: false` is what stops a receipt
from authorising a skip it never earned.

**What it refuses to judge.** A change with fewer than fifteen added lines, where one
comment reads as 33% and means nothing. And a change that removes at least as many
comment lines as it adds **in the files it also added to**, which cannot be the failure
this catches. Two things were learned building that exemption: without it the commit
that cleaned `src/` scores 100%, because it rewrote the few comments it kept; and
scoped to the whole diff rather than to the touched files, deleting a module buys credit
to write prose somewhere else.

**What counts as a comment is scanned, not guessed.** A line starting with `*` is a doc
continuation or a markdown bullet inside a template literal, and `init` writes hundreds
of the second kind. A file with no comments at all measured 33% before the scanner
existed.

**When it fails:** cut the comment, or move it. History, a rejected alternative, and
what a module used to do belong in the commit body or in `.wst/memory/decisions.md`.
A comment that recounts a change is stale the moment the next one lands.

Deterministic checks may block freely (constitution non-negotiable 7). This one
compares two counts against a number written down above.
