---
id: run-the-lens
description: "What a human does before opening a PR on strict paths: run the lens, because nothing else will."
kind: method
severity: annotate
tiers: [strict]
include:
  - "src/**/*.ts"
exclude:
  - "src/**/*.test.ts"
origin: [adr-0018, adr-0027]
version: 1
---

Run `wst gate` on this change before you open the PR. Without `--no-lens`.

`correctness` earned `block` by measurement, twice, and adr-0027 gave it CI to fire in. Two
days later CI began running `--no-lens`, because a runner has no OAuth session and the lens
errored on every run without an API key. A red nobody can clear is not a signal, so removing
it was right, and the two decisions together leave the lens with nowhere to fire. adr-0027
carries `· unbuilt` for that reason.

So the only thing standing between a strict change and the one check that reads it for meaning
is a person choosing to run it. That is a weaker guarantee than a gate and this file does not
pretend otherwise: a method is annotated, never enforced, and the gate will report it as
`declared` and move on.

It costs roughly fifty seconds and cents, scaling with the size of the diff. It is worth it on
a change to `src/**/*.ts` and it is not worth it anywhere else, which is what the `include`
above says.

If it errors rather than passing or failing, that is the gate being broken, not your change.
Read the kind it reports before you read it as a verdict.
