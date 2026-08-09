# Retro proposals

Signals sig-0017 … sig-0018 (2 new).
**Nothing here has been applied.** Approving is a human act.

### Proposal 1 — amend: .sdd/skills/delegation.md

**Add a "Judges vs. crewmates" note (and invert D7 for judges): a hermetic judge (no tools, no filesystem) can only reason about what is literally in its prompt, so artifacts it must judge — target file content, enumerable context like a skill list — need to be embedded inline, not passed as ids/paths for it to fetch.**

sig-0017 shows the retro proposer (a hermetic LLM judge, by design) was given only a path/id for the skill it had to amend, per D7's "pass references, not full content" guidance. Since a judge has no tools to fetch anything, that produced literal placeholder output on 3 of 4 proposals. The root cause isn't the retro pipeline's code — it's that delegation.md's existing D7/fresh-context guidance was written exclusively for crewmates (which have tools and fetch on demand) and never named the judge case, where the same instruction is exactly backwards. The smallest fix is a rule amendment clarifying this distinction so any future prompt-construction for a hermetic judge follows the opposite guidance from D7, rather than a code-only fix that leaves the rule silently wrong for the next judge built this way.

- cluster: `rule:skills/delegation.md`
- receipt: `sig-0017`
