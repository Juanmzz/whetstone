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
  status: passed
  runs: 10
  date: "2026-08-07"
  fixtures: test/fixtures/lens-correctness
  detail: 10/10 correct and unanimous on both known-good and known-bad (claude 2.1.225, sonnet, $0.79).
origin: [adr-0008, sig-0007]
version: 1
---

The first `agent-lens` check, and the reason the calibration harness exists.

**Why this is `warn` and not `block`, despite passing calibration.** The schema would
permit `block` — the receipt above is genuine. It stays at `warn` because the fixtures it
passed on are mirror images of each other (removing versus adding a null check before a
dereference), which is unambiguous by construction. That measurement proves the harness
works and that the easy case is stable. It says nothing about borderline diffs, and a
gate lives on borderline diffs.

**To promote this to `block`:** add fixtures where a competent reviewer would hesitate —
a subtly wrong concurrency fix, an off-by-one at a boundary, a change that is correct but
looks wrong — re-run `npm run calibrate`, and record the result. If it flips there, it
stays at `warn`. That is the system working, not failing.

See `test/fixtures/lens-correctness/RESULT.md` and ADR-0008.
