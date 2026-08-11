---
id: adr-0012
ts: 2026-08-10
status: proposed
supersedes: null
rules_affected: ["skills/doc-locations.md"]
---
# Do not claim generic vocabulary in a foreign repo: rename `.sdd/` to `.wst/`

## Context

Whetstone writes a directory into every repo it is installed in. It is called `.sdd/`,
for spec-driven development. Two forces make that name a defect rather than a taste.

**The name is already owned, and the owner has the opposite rule.** In ChytaPay's
`agilpay-backend`, the first repo Whetstone was installed into that it did not grow up
in, "SDD" already means something concrete: a plugin workflow with phases
(`sdd-propose`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-apply`, `sdd-verify`,
`sdd-archive`) whose artifacts live in engram under topic keys like
`sdd/integration-docs-bot/spec`. One of that workspace's standing rules is that SDD
artifacts go to engram ONLY, and that no process files are created in the app repo.
Whetstone then creates, in that same repo, a directory called `.sdd/`.

That is not confusing, it is contradictory, and it is an operative contradiction rather
than a cosmetic one. An agent reading the rule and seeing the directory will resolve it
in the dangerous direction: writing process artifacts into `.sdd/`, or hunting there for
artifacts that live in engram. It is the same family as the rest of the ChytaPay field
report, with one turn of the screw. In the other findings Whetstone asserted something
false ABOUT the host repo. Here it imposes on the host a vocabulary that was already
taken.

**The name contradicts the project's own positioning.** `AGENTS.md` opens by stating
Whetstone is "Not a spec framework, not a memory server." `.sdd` claims a generic
industry term that Whetstone did not coin, does not implement, and takes the trouble to
disown in its own first paragraph. This argument survives ChytaPay: it would hold if
that repo never existed, and it is the reason this belongs in an ADR rather than a
ticket.

The window is now. The only external install is `agilpay-backend`, and its payload is
still uncommitted, waiting on this decision. Migrating costs zero today and will never
cost zero again.

### The surface is larger than it looks

225 occurrences across 40 files in `src/`, plus `plugin/hooks/`. **There is no
centralised constant.** Only 9 are the path literal; 108 sit inside prose that `init`
generates and writes into the target repo. A rename done as a find-and-replace over 225
sites will drift the first time someone touches one of them.

### Alternatives weighed

- **Support both paths for backward compatibility.** Rejected. Two possible directories
  means five commands must decide which wins when both exist, and a repo holding
  `.sdd/` and `.wst/` at once has no source of truth. Indeterminacy is the thing this
  project exists to remove. ADR-0009 sets the precedent: it deleted a subsystem rather
  than deprecating it.
- **Make the name configurable in `wst.yaml`.** Rejected twice over. `wst.yaml` lives
  inside the directory it would name, and worse, configurability forces all 108 prose
  sites to interpolate the value, which is a rewrite of the emitter to buy flexibility
  nobody asked for, multiplying the surface where generated prose can fall out of sync
  (the sig-0042 defect).
- **Keep `.sdd/` and document the collision.** Rejected. A documented contradiction is
  still a contradiction, and the reader who needs the document is the one who will not
  read it.

## Decision

**We will not claim generic industry vocabulary in names Whetstone writes into repos it
does not own.** The directory is renamed from `.sdd/` to `.wst/`, and this constraint
applies to anything the emitter names in future.

Three parts:

1. **The directory name gets exactly one owner in the code.** A single exported constant,
   used both for path construction and interpolated into generated prose. Its value is
   fixed in code. This is a single source of truth, NOT a configuration option, and the
   distinction is the whole point: it makes the rename a one-line change and stops the
   225 sites from drifting apart. Extracting it is a precondition, not a consequence.

2. **Clean migration. No dual path.** `wst` reads `.wst/` and nothing else. But it must
   not fail blankly: a repo holding `.sdd/` and no `.wst/` gets an error naming the old
   directory and the migration command. That is diagnosis, not compatibility, because
   nothing is loaded from it.

3. **`memory/out-of-scope/` is added** as the fourth memory artifact. Today
   `memory/` records what went wrong (`signals.jsonl`), what was decided
   (`decisions/`), and what was proposed (`proposals/`, `retro-log.md`). Nothing records
   what was deliberately refused, and a refusal without a file gets re-proposed every six
   months with the argument re-derived from scratch. Each entry states what was asked,
   why it is out of scope, what escape hatches already exist, and the request that
   prompted it. The form is borrowed from `mattpocock/skills` (MIT), whose `.out-of-scope/`
   is the same idea; the attribution belongs in the emitted file, per rule 7, because a
   reference to Whetstone's own LICENSE dangles in a target repo.

**The tradeoff accepted:** anyone who installed Whetstone before this must rename a
directory by hand. Today that is one repo, uncommitted, so the cost is a decision rather
than a migration. Taken later, the same decision costs a real migration in someone
else's repository.

## Consequences

**Easier.** The collision disappears without anyone having to remember it: Whetstone
stops reclaiming a word it never owned, and the host decides what to do with the name.
`out-of-scope/` gives a home to two refusals already waiting: the retro proposal declined
"for want of a home" that `AGENTS.md` records under Known weaknesses, and the decision
not to move Linear tickets on merge. Both slot in where `retro` already has permission
to propose (`retro.ts:50` requires targets under the definition directory), so neither
needs new plumbing.

**Harder.** Every document naming `.sdd/` has to change with the code, including
`README.md`, `VISION.md`, `AGENTS.md`, `architecture.md` and `constitution.md`, which
already carry roughly 25 stale lines. The rename cannot be split across lanes:
`lanes.yaml` denies shared seams to every lane on the grounds that "changing one of these
invalidates the assumptions the other lanes are working under, so it is a conversation,
not a commit." The constant is exactly that, so this goes first and alone.

**What this deliberately does NOT decide.** The directory holds three pairs that state
the same thing twice: `triage-rules.md` with `triage.yaml`, and `checks/*.md` with
`checks/_index.json`. The intent is sound (a human reads the prose, the engine reads the
data) but a pair that can disagree is where drift lives, which is the subject of the
entire field report. Whether one is generated from the other is a separate decision, and
moving the directory does not resolve it. Recorded here so it is not lost.

**Blocked on.** Nothing. This is the first item on the critical path to committing the
payload in `agilpay-backend` and running a real task there.

**What reverses this.** If `.wst` turns out to collide with something equally established,
the decision stands and only the name changes: the constraint is the decision, the name
is its consequence.
