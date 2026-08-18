---
id: untested
description: In tier strict, a module never arrives without a test.
kind: deterministic
severity: warn
tiers: [strict]
include: ["src/core/**/*.ts"]
exclude: ["src/core/**/*.test.ts"]
command: npm run untested
origin: [sig-e8dfefd0]
version: 1
---

Hard rule 4 puts `src/core/**` at strict tier, and `core/history/untested.ts` has measured
it over real commits since 2026-08-12. Nothing ran it. A rule enforced only by intention is
a rule that holds while somebody is paying attention.

**What it claims, and why not more.** A module counts as tested from the moment any commit
touched its colocated `*.test.ts`, or from the start if the test predates the range. That is
weaker than TDD — git cannot tell a test written first from one written afterwards and
committed first — but it is the strongest claim the evidence supports, and a check that
inferred more would be the "measured, not chosen" failure `[TD7]` warns about.

**What it deliberately does not check:** whether the test is any good, or whether the code
came first. Only that a strict-tier module did not ARRIVE without one.

**Why it is not `red-first`.** A separate check was written for this on 2026-08-12, when hard
rule 4 read "RED first, in its own commit", and it verified that a test commit PRECEDED the
implementation. On 2026-08-14 the retro amended [TD1]/[TD2] against `sig-e8dfefd0`: separate
RED and GREEN commits are unwanted, and the rule as written produced the thing it existed to
prevent. Run afterwards over 74 commits it reported 9 findings, every one a correct commit.
Narrowed to what survives, it became a byte-for-byte second copy of this module — `isTestPath`
and `moduleKey` identical, the same finder — so it was deleted rather than registered. [L12]:
find the first implementation before writing the second.

**When it fails:** add the test. If the module genuinely cannot carry a colocated one, it is
in the wrong layer, which is a design answer rather than a testing one.

Held at `warn`. It reports zero on this repo's history today, so the severity is not what is
holding it back — a check that has never been red on real work has not earned the authority
to stop one.
