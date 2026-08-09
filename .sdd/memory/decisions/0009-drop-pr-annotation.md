---
id: adr-0009
ts: 2026-08-09
status: accepted
supersedes: null
rules_affected: []
---
# Drop `wst pr`; the gate's exit code is the only channel Whetstone owns

## Context

`wst pr` annotates a pull request by criticality — 🔴 review, 🟡 skim, ⚪ skip — so a
reviewer knows where to look. It is 2,881 lines across `commands/pr.ts`,
`core/annotate/` (11 files) and `shell/github.ts`: **18% of the project**, the third
largest subsystem after `init` and `gate`.

Three things came due at once.

**It does not work in the way that matters.** On this repo's own PR #1 it produced
`0 to review, 82 to skim, 68 trivial` — 82 of 150 files marked "worth a skim". That
list is the set of strict-tier files, which the reviewer already knows from the paths.
`core/annotate/criticality.ts` documents this exact failure mode, keeps
`naiveMaxCriticality` as a live counter-example so a test can demonstrate it, and
argues that "a marker that is on for every file in a directory carries no
information" — and then `tierFloor(strict) = "skim"` reproduces it one rung down. The
argument that denies the tier a 🔴 applies word for word to 🟡.

**It is the most redundant thing here.** An outside survey found
[reviewdog](https://github.com/reviewdog/reviewdog) filtering annotations to changed
lines, [CodeScene](https://docs.enterprise.codescene.io/versions/6.6.16/guides/delta/automated-delta-analyses.html)
already recommending a review level per PR from predicted delivery risk, and
[Danger](https://github.com/danger/danger-js), [PR-Agent](https://github.com/qodo-ai/pr-agent)
and several LLM reviewers occupying the rest. Nothing in `wst pr` is unavailable
elsewhere and further along.

**Its value is downstream of something unproven.** Criticality is only informative
when findings exist to raise it, and findings come from the `correctness` lens, which
sits at `warn` and `uncalibrated`. With no findings the annotation degenerates into a
listing of the tier. Fixing the 🟡 rule does not change this: it makes an empty
annotation smaller, not more useful.

### Alternatives weighed

- **Fix `tierFloor(strict)` to `skip`.** Cheapest. Rejected as insufficient: it
  produces a correct annotation that is almost always empty, and 2,881 lines that
  emit nothing is worse than none.
- **Earn the 🟡 only where a strict file had no check coverage** ("critical file
  nobody verified"). Genuinely informative and the best of the repair options, but it
  keeps 18% of the project alive on the bet that the lens gets calibrated.
- **Keep it and calibrate the lens first.** The honest sequencing, and rejected only
  because the lens has already failed the bar once on false positives; the wait is
  open-ended and the code is carried the whole time.
- **Emit to reviewdog's format instead of GitHub's API** and let a mature tool
  render. Attractive, and available later — the criticality rule is 100 lines, the
  2,700 around it is transport and rendering that reviewdog already owns.

## Decision

We will delete `wst pr`, `core/annotate/` and `shell/github.ts`.

Whetstone keeps exactly one enforcement channel: **the gate's exit code**, running in
a pre-push hook and in CI. That channel does not depend on an agent cooperating, on a
model being calibrated, or on a forge's API.

The tradeoff accepted: Whetstone stops having anything to say *inside* a pull request.
A reviewer gets pass or block and the gate's own report, and nothing about where to
look. That is a real loss on large diffs, and we take it because the thing being lost
was not delivering the information it promised.

`core/annotate/criticality.ts` is worth keeping in mind rather than in the tree: the
tier-as-floor rule is a good idea that this project could not afford to host. Git
history holds it.

## Consequences

**Easier.** The project drops to ~13,000 lines. One fewer surface needing a GitHub
token, one fewer CI step, one fewer place the check runner could drift from the gate's
(`commands/gate.ts` exported `createCheckRunner` specifically because `pr` had kept a
copy that diverged). The positioning simplifies to one sentence: Whetstone gates, it
does not review.

**Harder.** Nothing in a PR points a human at the risky files. On a 150-file change a
reviewer is on their own or on another tool's output.

**What reverses this.** If the `correctness` lens earns a calibration receipt and
starts producing findings a human agrees with, criticality becomes informative and is
worth rebuilding — as a renderer over reviewdog's format rather than a GitHub client.
Recover the rule from this commit's parent, not from memory: the counter-example in
`criticality.ts` is the part worth having back.
