---
id: correctness
description: Does this diff introduce a correctness bug?
kind: agent-lens
severity: warn
tiers: [strict]
include: ["src/**/*.ts"]
exclude: ["src/**/*.test.ts"]
review_lens: >-
  You are a correctness review lens for a code gate. Decide whether this diff INTRODUCES a
  correctness bug.


  First identify the CONTRACT the changed code is meant to satisfy: its doc comment, type
  signature, error semantics, and any documented post-condition. Judge the change against
  that contract — not against how you would have written it.


  A verdict of 'fail' requires you to name a CONCRETE input, value, or interleaving that
  produces observably wrong behaviour under that contract. State it in your reason. If you
  cannot name one, the verdict is 'pass'.


  The following are NOT bugs: a different but equivalent idiom; a change that is stricter
  or looser in a way the contract permits; a style you would not have chosen; code that
  looks unusual but satisfies the documented behaviour.


  Judge only the change itself, not the surrounding file.
calibration:
  status: failed
  runs: 5
  date: "2026-08-08"
  fixtures: test/fixtures/lens-correctness
  detail: >-
    v3 (contract-justification) measured unfiltered: 9/10 fixtures clean, 0/50 blind runs,
    still zero false negatives (all five `-bad` fixtures 5/5). race-good flipped once in
    five — one false positive on correct code. Large improvement over v2 (which failed on
    two fixtures with ~20% false positives and 13/80 blind), but one flip is still a flip:
    ADR-0008 pre-registered unanimity, not accuracy. Capped at `warn`.
origin: [adr-0008, sig-0007, sig-0008, sig-0011]
version: 3
---

The first `agent-lens` check, and the reason the calibration harness exists.

**Why this is `warn`, and now cannot be anything else.** The 2026-08-07 run passed 10/10,
but on two mirror-image fixtures — unambiguous by construction. The debt that result
recorded has been paid: eight harder fixtures landed on 2026-08-08 and the lens **failed**.
The schema now refuses `severity: block` outright while `calibration.status` is `failed`.

**The shape of the failure matters more than the rate.** The lens never missed a planted
bug (31/31 on decided runs, including the two hard ones). It fails the other way: ~20%
**false positives on correct code** — calling the idiomatic `== null` widening a bug, and
a correctly `finally`-cleared single-flight refresh a bug. That is the worst shape for a
gate. Missing a bug costs you one bug; crying wolf on correct work gets the gate routed
around, and a routed-around gate has negative value. This is precisely why ADR-0008
pre-registered *unanimity* rather than accuracy.

It is a good **annotator** and not yet a gate.

**To promote this to `block`:** change the lens, then re-run `npm run calibrate`
unfiltered. Re-running the same lens on the same fixtures will fail the same way. The
cheapest next experiment: require the lens to justify a `fail` against the change's stated
contract — both false positives ignored a doc comment that documented the behaviour they
flagged. Do not adjust a fixture to make the lens pass; ADR-0008 pre-registers against it,
and the two it got wrong are the two most likely to tempt you.

See `test/fixtures/lens-correctness/RESULT.md` and ADR-0008.
