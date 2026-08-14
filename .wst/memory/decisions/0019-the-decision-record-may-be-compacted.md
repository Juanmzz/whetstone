---
id: adr-0019
ts: 2026-08-14
status: accepted
supersedes: adr-0007
rules_affected: ["skills/recording.md"]
---
# The decision record may be compacted, keeping the rejected alternative

## Context

ADR-0007 decided that an ADR is amended only by a `status` transition, never by
editing accepted prose, and that **nothing is deleted** — *"the audit trail is the
point."*

That was right, and it was decided before there was any evidence about which part of
an ADR gets read. There is now:

```
18 ADRs · 1,535 lines
supersedes: null in all 18 — the supersession mechanism has never been used
167 lines are rejected alternatives (11%)
ADR-0008 cites 10 other ADRs; ADR-0013 and ADR-0014 cite 9 each
```

The chain ADR-0007 protects does not exist. What exists is a citation web, and
nothing in the frontmatter tells a reader which parts are still live — so answering
"what is true now" means reading 1,535 lines and inferring.

**The audit trail is the point, and git is an audit trail.** ADR-0007 does not
mention git; it protects the text as if the filesystem were the only record. Every
deleted line is recoverable by `git log --diff-filter=D`, with its author and date.
What git cannot reconstruct is which *argument* was rejected — the diff shows a
decision was made, not what it was made against.

ADR-0017 narrowed what earns an ADR and explicitly refused to touch this:
*"Narrowing what earns an ADR is not the same as making the ones we have editable."*
That was the correct boundary — this is ADR-0007's territory, and it takes a decision
under ADR-0007's own process to change it.

### Alternatives weighed

- **Keep ADR-0007 unchanged and consolidate anyway.** Rejected: that is hard rule 6
  as advisory, in the one place the project is least able to afford it. A governance
  rule broken once by the people who wrote it is a governance rule.
- **Keep ADR-0007 and never consolidate.** The honest status quo. Rejected on the
  measurement: 89% of the corpus is context and consequences that either landed in
  the code or belong in `architecture.md`, and the mechanism protecting it has never
  fired.
- **Delete the record entirely; git is the trail.** Rejected for the reason ADR-0017
  gives: a decision to NOT do something has no commit, so it has no home in git and
  gets re-litigated. That is what ADR-0011 exists to stop.
- **Compact but drop `status`.** Considered and rejected once it was tried: a review
  found that removing the field deletes the only sanctioned amendment mechanism, in
  the same change that uses it. `src/core/retro/propose.ts` still ships a `flip-adr`
  recommendation with nothing left to flip.

## Decision

The decision record may be **compacted into one page**, one anchored entry per id,
carrying:

- **the rejected alternative and why** — the content git cannot reconstruct, and the
  reason an ADR exists at all under ADR-0017
- **`status`**, per entry, as a field. It is what a retro flips, and dropping it
  breaks ADR-0007's mechanism while claiming to inherit it
- **the date and the signals cited** — cheap, and the provenance a rule points back to

The full text of a compacted ADR moves to git history. `git log --diff-filter=D --stat
-- .wst/memory/decisions/` is the recovery path, and it belongs in the page.

**Accepted prose is still not rewritten.** Compacting is selecting, not editing: an
entry may drop a paragraph, never reword one into something the decision did not say.
Commentary written later goes in a new entry, not into an old one's voice.

**The human gate stands** (ADR-0003). A retro may propose a compaction; a human merges
it.

**The tradeoff accepted:** a reader who wants the full reasoning behind a decision now
runs a git command instead of opening a file. We take that because the measurement says
almost nobody was opening the file, and everybody was paying for it.

## Consequences

**Easier.** One page answers what has been ruled out. `architecture.md` answers what is
true. Neither requires assembling seventeen files.

**Harder.** "Selecting, not editing" is a judgment call at every entry, and the cheap
mistake — tightening a sentence until it says something adjacent — is invisible in the
result. The diff is the only guard, so a compaction is reviewed by reading it against
the original, not by reading the output.

**What this does not touch.** `constitution.md` stays exempt (ADR-0007 kept it exempt
and so does this). The retro still proposes and never applies.

**What reverses this.** If a compacted entry turns out to have dropped the thing
someone needed, and git history was not consulted because nobody thought to, then the
page is not a record — it is a summary, and the full files should come back.
