---
id: adr-0016
ts: 2026-08-13
status: proposed
supersedes: null
rules_affected: []
---
# `init` reads declared facts and stops inferring conventions

## Context

`init` is **3,081 lines** — 2,529 in `src/core/init/` plus 552 in `commands/init.ts` —
which is **29% of the implementation**, against 995 for the gate and 2,592 for the
whole enforcement loop. It is the largest thing in the project by a wide margin, and
it is the one command that has never run against a repository that is not this one.

ADR-0010 sequenced distribution *after* the gate proves itself. This code is ahead of
its own roadmap.

**The part that does not belong is identifiable, and it is not "init".** Whetstone's
thesis is that the LLM proposes and the engine verifies. `detect.ts` (447 lines) plus
`walk.ts` (81) are the one place the engine *guesses*: hand-maintained tables of
lockfiles, CI markers, source directories and file extensions, plus a regex over
recent commits to decide whether a project uses Conventional Commits.

`sig-0041` is what that style of thinking costs. The charter hardcoded `AGENTS.md` and
`.wst/architecture.md`; neither is written by `init --definitions-only`, and
`architecture.md` exists only in this repo — so the first install into a foreign repo
ordered an agent to read two files that were not there.

**But detection is not one thing.** Its twelve outputs split cleanly:

| Reads a declared fact | Infers a convention |
|---|---|
| `commands` — the scripts `package.json` declares | `language` — from counting file extensions |
| `packageManager` — from the lockfile present | `sourceGlobs` — from a list of directory names |
| `hasTests` | `commitStyle` — a regex over recent commits |
| `evidence` — what was read, and from where | `ci` — a five-entry marker table |
|  | `greenness`, `solo` |

The left column is not guessing. A `package.json` states its scripts; a lockfile
states its package manager. Reading them is cheap, deterministic, auditable, and it
produces the one thing a check cannot do without — a `command` to run. The right
column is inference, and inference is what breaks on a stack nobody tabulated.

**One fact makes the tradeoff real.** `init` works today with **no model at all**;
`--propose` is optional and the code checks whether a judge exists before advertising
it. Deleting detection outright would make bootstrapping cost a model call. That is a
genuine regression, and it is why "delete `detect.ts`" is the wrong shape.

### Alternatives weighed

- **Delete `detect.ts` and `walk.ts` entirely; the agent reads the repo.** The largest
  cut and the most on-thesis. Rejected because it makes `init` unusable without a
  judge, and because the left column above is genuinely better done by code: an agent
  asked for the test command may paraphrase it, and a paraphrased command is a check
  that runs the wrong thing.
- **Freeze `init` and cut nothing.** Rejected: 29% of the project frozen is still 29%
  of the project to read, and its size is what makes the tool feel out of control.
- **Delete `init` outright and bootstrap by hand.** Seriously weighed — a `.wst/` is a
  dozen files and a person could copy them. Rejected because `selfcontained.ts` and
  `collisions.ts` are real enforcement (ADR-0004, and not clobbering files), and
  hand-copying loses both.
- **Keep everything and grow `propose.ts` alongside.** Rejected as the worst of both:
  two paths to the same answer, drifting, which is the failure mode this repo already
  has three bugs from.

## Decision

`init` reads what a repo declares and asks about everything else.

**Delete the inference.** The language/extension tables, the source-directory name
list, the CI marker table, and the commit-style regex go. Whatever of `walk.ts` exists
only to feed them goes with them.

**Keep the reading.** `package.json` scripts, the lockfile, whether tests exist, and
the `evidence` trail that makes a plan auditable. This keeps `init` working with no
model for the facts a check depends on.

**Everything inferred becomes something asked** — of a human, or of an agent through
`--propose`, which already exists. An agent reading the repo answers "what language is
this, and where does its code live" better than a table, and it adapts to stacks
nobody enumerated.

**Keep, and this is not a compromise:** `payload.ts` (the templates are content, not
logic, and a constitution must not be model-invented), `triage.ts` (a deterministic
compiler is exactly what should be code), `selfcontained.ts` and `collisions.ts` (both
are enforcement), `plan.ts` and `artifact.ts` (the write mechanism as pure data).

**The tradeoff accepted:** a repo with no judge configured gets a thinner `init` — it
still writes a working `.wst/`, but the parts that used to be guessed are now blank
until someone answers. We prefer a blank a human fills to a table's confident wrong
answer, because `sig-0041` is what the confident wrong answer looks like from inside a
foreign repo.

No line count is promised here. The implementer reports what actually came out.

## Consequences

**Easier.** The largest subsystem stops being the largest. `interview.ts` and
`commands/init.ts` shrink on their own, since much of both is choreography between
"what I inferred" and "what I still have to ask". And `init` stops being the one place
where Whetstone does the thing it tells everyone else not to do.

**Harder.** Bootstrapping a repo with an unusual stack now needs a person or a model
in the loop where it used to be silent. That is the point, but it is still a step that
did not exist before.

**What this does not decide.** Whether `init` should exist at all. ADR-0010 sequences
distribution after the gate proves itself, and if that never happens the right move is
deletion, not further trimming. This ADR makes the subsystem proportionate; it does
not argue it has earned its place.

**What reverses this.** If the asked-for answers turn out to be the ones people skip —
a `.wst/` shipped with blanks where the tables used to guess — then the guess was
carrying more weight than it looked, and the tables should come back for the specific
facts people would not answer.
