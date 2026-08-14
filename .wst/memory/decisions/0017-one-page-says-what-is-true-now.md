---
id: adr-0017
ts: 2026-08-14
status: proposed
supersedes: null
rules_affected: ["skills/recording.md", "skills/doc-locations.md"]
---
# One page says what is true now; an ADR only records a rejected alternative

## Context

Sixteen ADRs, 1,438 lines, and **`supersedes: null` in all sixteen**. The mechanism
that justifies keeping a chain has never once been used.

What exists instead is denser and worse for a reader — a citation web:

```
ADR-0008 cites 10 other ADRs
ADR-0013 cites  9
ADR-0014 cites  9
```

A chain can be walked. A web has to be assembled, and nothing in the frontmatter tells
you which parts are still live. **A reader who wants to know what is true now reads
1,438 lines of historical decisions and infers.** That is the opposite of
deterministic, in a project whose whole claim is determinism.

`.wst/architecture.md` is supposed to be the answer and is not: it went stale five
times, most recently claiming a plan gate that did not exist for four days after the
command that would have carried it was removed. `docs-fresh` and `skill-shape` were
written in the last two days because putting something in git does not keep it true.

**What git already gives us.** Every change, with author, date and diff. What it does
not give is the *argument* — the diff shows `wst run` was deleted; it cannot show that
the reasoning was about commoditised dispatch and not about the briefing. ADR-0014
needed exactly that distinction and got it by reading ADR-0011 intact. That is the one
thing worth the ceremony, and it is a small fraction of what the sixteen files hold.

### Alternatives weighed

- **Keep the practice as it is.** Rejected: an unused `supersedes` field and a
  nine-deep citation web are cost with no reader. The project already applies this
  argument to itself — `wst pr` was deleted for producing annotations nobody could use.
- **Delete the ADRs; git history is the record.** Tempting and wrong in one specific
  way. A decision to NOT do something (no workflow engine, no fleet manager) has no
  commit, so it has no home in git and gets re-litigated every few weeks. That is
  precisely what ADR-0011 exists to stop.
- **Generate the current-state page from the ADRs.** Rejected: it makes the sixteen
  files load-bearing forever and turns a documentation problem into a compiler.
- **A wiki, or a page rewritten in place with no record.** Rejected for the same reason
  the second alternative is: the rejected options vanish, and they are the content.

## Decision

**An ADR records a decision that rejects an alternative.** If a change has no seriously
weighed alternative, it is a commit message, not an ADR. The bar is: *would someone
propose this again in three months?* If yes, write it down; if no, the diff is enough.

**`supersedes` comes out of the template.** Sixteen files never used it. A field nobody
fills is not traceability, it is a thing that has to be explained.

**`.wst/architecture.md` becomes the single statement of what is true now** — the
layers, the commands, the boundary, and a mermaid diagram of the loop. It is written
in the present tense, it never argues, and it is **checked** the way `AGENTS.md`'s
counts are: whatever in it can be verified against the code, is. An ADR then stops
being something a reader must consult and becomes what you open when you are about to
change the decision it records.

**Two logs stop accumulating.** Skill changelogs compress to one line per version —
what changed and which signals earned it, no re-argument, which is [DL7] applied to
itself. And `.wst/memory/proposals/retro-NNNN.md` is deleted once `retro-log.md`
records the decision: it is read once, and the durable record is the log entry plus the
amended skill.

**The tradeoff accepted:** a decision that turns out to matter later, and was written
as a commit message because it had no rejected alternative at the time, is harder to
find. We take that over sixteen files nobody can summarise, because the failure mode we
actually have is the second one.

## Consequences

**Easier.** A new agent, or a new person, reads one page and knows what the tool is.
That is the question this project has answered worst, and it is the one asked most.

**Harder.** "Is this an ADR or a commit message?" becomes a judgment call at every
change, and the wrong answer in the cheap direction loses an argument permanently.
`recording.md` gains the test — a rejected alternative — but a test is not a rule that
applies itself.

**What this does not touch.** ADR-0007's status flip stays: the retro amends a decision
by moving `proposed` → `accepted` → superseded-by-id-in-prose, and accepted prose is
still not rewritten. Narrowing what earns an ADR is not the same as making the ones we
have editable.

**What reverses this.** If `architecture.md` goes stale a sixth time despite being
checked, the problem is not where the truth lives but that nobody maintains it, and the
answer is to generate it or delete it rather than to add another page.
