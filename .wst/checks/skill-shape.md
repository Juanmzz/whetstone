---
id: skill-shape
description: Every skill and every amended check declares a version its changelog records.
kind: deterministic
severity: block
tiers: [strict, light]
include: [".wst/skills/**/*.md", ".wst/checks/**/*.md"]
command: npm run check:skills
origin: [adr-0017, adr-0019, adr-0047]
version: 2
---

`.wst/skills/**` is strict tier and nothing covered it, the third place in one day where
the definition layer, which is what this tool exists to protect, was the part no check
looked at. A skills-only change could not even be pushed: the gate found no applicable
check and refused, correctly.

**What it checks:** frontmatter parses, `version` is a positive integer, a `## Changelog`
exists, and its newest `- vN` entry is the version the frontmatter claims.

That last rule is the one with teeth. `wst init` copies these files verbatim into every
bootstrapped repo, so a skill amended without a bump leaves two repos on "v3" holding
different text, a rule nobody can cite. The retro amends by version (ADR-0007), which is
why the number and the log have to agree.

**Checks too, since adr-0047.** A `review_lens` is prose defining what correct means here,
which is what a skill is; it just asks the question instead of giving the instruction.
`correctness` carried `version: 4` with no changelog behind it for three weeks because
nothing looked at this side of `.wst/`.

**A check at v1 is exempt.** It has never been amended, so it has no history to record.
The requirement starts at v2, where the number becomes a claim about a past.

**What it does not check:** whether a rule is good. That is a retro's judgment. Whether a
file claims a version its changelog does not record is a fact.

## Changelog

- v2 (2026-08-30): Covers `.wst/checks/**` too, from v2 upward. adr-0047.
- v1 (2026-08-14): Added after a skills-only change could not be pushed, because the gate
  found no applicable check and refused.
