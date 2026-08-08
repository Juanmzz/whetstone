---
id: correctness
description: Does this diff introduce a correctness bug?
kind: agent-lens
severity: warn
tiers: [strict]
include: ["src/**/*.ts"]
exclude: ["src/**/*.test.ts"]
review_lens: >-
  You are a correctness review lens for a code gate. Given a diff, decide whether it
  INTRODUCES a correctness bug. verdict='fail' means the diff introduces a bug;
  verdict='pass' means it does not. Judge only the change itself, not the surrounding
  file. Be decisive.
calibration:
  status: failed
  runs: 10
  date: "2026-08-08"
  fixtures: test/fixtures/lens-correctness
  detail: >-
    FAILS the block bar on the full fixture set. False positives on borderline-CORRECT
    diffs — 2/10 on nullish-good, 2/9 on race-good (~20%) — while never missing a planted
    bug (31/31). Supersedes the 2026-08-07 "passed" result, which used only two
    mirror-image fixtures. See RESULT.md.
origin: [adr-0008, sig-0007, sig-0008]
version: 2
---

The first `agent-lens` check, and the reason the calibration harness exists.

**Why this is `warn`, and now cannot be anything else.** The 2026-08-07 run passed 10/10,
but on two mirror-image fixtures — unambiguous by construction. The debt that result
recorded has been paid: eight harder fixtures landed on 2026-08-08 and the lens **failed**.
The schema now refuses `severity: warn` outright while `calibration.status` is `failed`.

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
