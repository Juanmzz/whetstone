---
id: test
description: The test suite passes, with no network calls and no token cost.
kind: deterministic
severity: block
tiers: [strict, light]
include:
  - "src/**/*.ts"
  - "test/**/*.ts"
  - "scripts/**/*.ts"
  - "*"                    # every root file: definition-dir.test.ts enumerates them
  - ".wst/**"
  - "docs/**"
  - "plugin/**"
  - ".githooks/**"
  - ".claude/hooks/**"
command: npm test
slow: true
origin: [adr-0008, sig-0005, sig-0006]
version: 3
---

**The `include` is the whole repository, because the suite reads the whole repository.**

`include` is what invalidates this check's receipt. When it names less than the command
actually reads, a receipt keeps matching after something that changes the answer has
changed, and the gate skips a check that would now fail. Demonstrated: editing a
repo-root file broke the suite, the receipt still matched, and `wst gate` printed
`passed` and exited 0.

Nine test files read the repository outside `src/` and `test/`: `definition-dir` walks
`docs/`, `plugin/`, `scripts/`, `.githooks/` and enumerates every root file;
`architecture` greps `src/`; `lane-guard` compares `.claude/hooks/` against `.wst/`;
`triage-defaults` and `signal-log` read `.wst/`. So the honest `include` is all of them.

This costs almost nothing in practice: a change under `src/` already matched. What it
adds is running the suite on documentation and `.wst/` changes, which is exactly where
those nine files assert, and exactly where the old `include` reported a verified pass it
had not earned.

The longer-term shape is to move repo-invariant assertions out of the suite and register
them as their own checks, the way `adr-refs`, `docs-fresh`, `provenance` and
`skill-shape` already are. Then `test` gets a bounded surface back. Until then, an
honest wide `include` beats a narrow one that lies.

Version bumped 2 → 3 so receipts minted against the narrower `include` are re-earned.

The default suite must stay free and offline. Live LLM tests are gated behind
`WST_LIVE_LLM=1`; a suite that costs money per run is a suite people stop running.

**When it fails:** read the failure before touching the test. Two of this project's own
signals came from tests catching real defects that looked like test problems:

- `sig-0005`: a payload that passed schema validation while carrying tool-call markup.
- `sig-0006`: a contamination guard so eager it would have rejected legitimate reviews
  of HTML/JSX.

Deleting or skipping the assertion would have shipped both.

**v3: `slow: true`.** It is 45 seconds of a 50-second gate. `gate --fast` skips it, which
is what makes a gate usable at a commit or when an agent stops rather than only at the
push, by which time the work has compounded. Nothing else changes: the push and CI still
run it, and it still blocks there.
