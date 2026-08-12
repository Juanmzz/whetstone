---
id: adr-shape
description: Every ADR has parseable frontmatter, a status in the enum, an id matching its filename, and the three required sections.
kind: deterministic
severity: block
tiers: [strict, light]
include: [".wst/memory/decisions/**/*.md"]
command: npm run check:adrs
origin: [adr-0007]
version: 1
---

This check exists for two reasons and the second one is the load-bearing one.

**The ADRs are structured data, not just prose.** `wst retro` amends a decision by
flipping its `status` (ADR-0007), the memory layer reads the frontmatter, and every
other document cites decisions by id. A malformed `status`, or an id that disagrees
with the filename, is a decision no reader and no tool can classify — and it fails
silently, because a broken ADR still renders fine on GitHub.

**Until this landed, no check matched a markdown file at all.** `test`, `typecheck`
and `correctness` are all scoped to `.ts`. A change touching only documentation
therefore selected zero checks, and `exitCodeFor` — correctly — refused to call that
a pass: *"a run that verified NOTHING is not a pass"*. The pre-push hook read the
exit 2 as "a required check could not run" and blocked the push. The first pure-docs
branch in this repo's history could not be pushed at all, and nobody had noticed
because the previous docs commit rode into `main` inside a PR that also carried code.

The fix that was NOT taken: loosening the exit code so "nothing applied" means pass.
That contradicts hard rule 3 and a documented incident. Making a document verifiable
is the honest direction.

**What this deliberately does not check:** whether paths cited inside an ADR still
exist. ADR-0007 forbids rewriting accepted prose, and ADR-0009 records the deletion
of `commands/pr.ts` and `core/annotate/`. An ADR citing a file that has since been
deleted is the historical record being accurate. A check that flagged it would demand
the one edit the constitution forbids.

**When it fails:** fix the frontmatter or add the missing section. It reports every
problem in one run rather than stopping at the first, so a batch of them is one pass
of edits, not one per push.

Deterministic checks may block freely (constitution non-negotiable 7). Every rule
here is a fact about the file itself, so there is nothing to calibrate and no way for
it to be wrong about a document it can read.
