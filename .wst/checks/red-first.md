---
id: red-first
description: In tier strict, a test commit precedes the implementation it covers.
kind: deterministic
severity: warn
tiers: [strict]
include: ["src/core/**/*.ts"]
exclude: ["src/core/**/*.test.ts"]
command: npm run red-first
origin: []
version: 1
---

Hard rule 4 makes RED-first mandatory on `src/core/**`, and until now nothing measured
it. Measured over all 138 commits of this repo: **42 findings — 35 where the test and
the implementation landed in the same commit, 7 where a module arrived with no test at
all.** Ten commits carry a RED label. A rule enforced only by intention is a rule that
holds while somebody is paying attention.

## Why this warns instead of blocking

Deterministic checks may block freely under non-negotiable 7, so this one is held back
by judgment, not by the schema. Three reasons, in order of weight:

1. **It would be red on every machine on day one.** 42 existing findings is not a gate,
   it is a wall. `.wst/checks/` already carries the argument in
   `src/core/init/checks.ts:154`, where `wst init` seeds `lint` at `warn`: a check that
   blocks a merge over something the team has not agreed to yet gets routed around, and
   after that it stops catching the real findings too.
2. **The evidence is weaker than the rule.** Git cannot distinguish a test written
   first from a test written afterwards and committed first. This check measures commit
   ORDER, which is the strongest claim the evidence supports and is not the same claim
   as TDD. Blocking on a proxy is how a gate loses the credibility it runs on.
3. **It has a known blind spot, and it is not hypothetical.** The pairing is a colocated
   `*.test.ts`. A module covered by a repo-level guard instead — `src/core/paths.ts`,
   covered by `test/definition-dir.test.ts` — reads as untested. That is the one true
   finding in the last 30 commits, and it is a finding a human should weigh, not a merge
   a machine should stop.

Promote it to `block` when the backlog is worked down and the blind spot is either
closed or accepted. Not before: the first false positive on somebody's real work is what
teaches a team to reach for `--no-verify`.

## What it does and does not claim

- **`same-commit`** — the module's test exists, and arrived in the same commit as the
  code, so it never got the chance to fail. A discipline miss.
- **`no-test`** — a NEW module arrived and no commit has touched a test for it. A
  coverage hole.
- **Not reported:** editing a module that never had a test. That is a pre-existing hole
  rather than a statement about ordering, and reporting it would fire forever on type
  declarations like `ports.ts` — the permanently-warning check that makes the real
  signal unreadable.
- **Not in scope:** strict paths that are not TypeScript modules (`.claude/hooks/**`,
  `.wst/skills/**`). They cannot carry a colocated test, so measuring them against one
  says nothing.

**When it fires:** split the commit. `git reset HEAD~`, commit the test alone and watch
it fail, then commit the code. If the test genuinely cannot precede the code — a pure
refactor, a rename — say so in the commit body; this check warns, and a warning you have
answered is done.

## Origin

`origin:` is **empty, and that is a debt, not an oversight.** Non-negotiable 4 says every
check cites the signals that earned it, and no signal in `signals.jsonl` names this. The
evidence above was measured directly from git rather than accumulated from friction, and
`signals.jsonl` is human-gated — `wst signal` is the human's command to type ([RC3]).
Record one and put its id here.
