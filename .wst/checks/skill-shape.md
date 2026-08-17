---
id: skill-shape
description: Every skill's frontmatter version matches its newest changelog entry.
kind: deterministic
severity: block
tiers: [strict, light]
include: [".wst/skills/**/*.md"]
command: npm run check:skills
origin: [adr-0017, adr-0019]
version: 1
---

`.wst/skills/**` is strict tier and nothing covered it — the third place in one day where
the definition layer, which is what this tool exists to protect, was the part no check
looked at. A skills-only change could not even be pushed: the gate found no applicable
check and refused, correctly.

**What it checks:** frontmatter parses, `version` is a positive integer, a `## Changelog`
exists, and its newest `- vN` entry is the version the frontmatter claims.

That last rule is the one with teeth. `wst init` copies these files verbatim into every
bootstrapped repo, so a skill amended without a bump leaves two repos on "v3" holding
different text — a rule nobody can cite. The retro amends by version (ADR-0007), which is
why the number and the log have to agree.

**What it does not check:** whether a rule is good. That is a retro's judgment. Whether a
file claims a version its changelog does not record is a fact.
