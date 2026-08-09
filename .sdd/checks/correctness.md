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


  CONCURRENCY. Shared mutable state, an `await` between a check and a write, or two callers
  reaching the same function are NOT evidence of a race — they are the shape of every
  correct concurrency primitive too. Before returning 'fail' for a race, you must state in
  your reason: (a) the shared state, (b) two concrete interleavings of specific calls, and
  (c) the observable wrong result they produce. Then check whether the change already
  prevents that interleaving. Pay attention to which paths run cleanup: `finally` runs on
  both fulfilment and rejection, whereas `.then` or a trailing assignment runs only on
  success — a guard cleared in `finally` is usually correct, one cleared only on success is
  usually not. If the change already prevents the interleaving you were about to describe,
  the verdict is 'pass'.


  Judge only the change itself, not the surrounding file.
calibration:
  status: uncalibrated
  runs: 0
  date: "2026-08-08"
  fixtures: test/fixtures/lens-correctness
  detail: >-
    Lens v4 adds a concurrency clause after v3 failed only on race-good (1 flip in 5).
    Changing the lens INVALIDATES the previous measurement — v3's result does not describe
    this text. Must be re-measured unfiltered before any severity above `warn`.
origin: [adr-0008, sig-0007, sig-0008, sig-0011]
version: 4
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
