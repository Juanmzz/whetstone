---
id: decisions
ts: 2026-08-14
status: active
origin: [adr-0017, adr-0019]
---
# Decisions

One entry per decision, in the order they were taken. Each carries **only what was ruled out
and why** — that is the part git cannot reconstruct, because a rejected option has no commit.
What a decision made easier, how it was implemented, and what was true around it at the time
are in the history and in `architecture.md`.

Every entry opens with a meta line: **status**, the date it was taken, the signals that earned
it, and the rules it governs.

```
### adr-0011 — build the event log; refuse the workflow engine
`accepted` · 2026-08-09
```

**`status` is the amendment mechanism** (adr-0007, as adr-0019 inherits it). A decision changes
by moving `proposed` → `accepted` → `superseded by adr-NNNN`. It never changes by rewriting the
prose above it. Only the retro proposes a flip; a human merges it.

**Cite a decision by id.** `adr-0011` resolves to the `### adr-0011` anchor below, from a
check's `origin:`, from a comment, from prose. `check-adr-refs` fails when a cited id has no
anchor here, and when an entry has no meta line.

**A new decision** gets the next id and an entry here. The bar is adr-0017's: a seriously
weighed alternative, and *would someone propose this again in three months?* If not, it is a
commit message.

**Compacting is selecting, never editing** (adr-0019). An entry may drop a paragraph; it may
not reword one into something the decision did not say. Commentary written later goes in a new
entry, not into an old one's voice.

**The full text of the nineteen files this replaces** is in git:
`git log --diff-filter=D --stat -- .wst/memory/decisions/` finds the commit that removed them.

---

### adr-0001 — memory is an interface, not a product
`accepted` · 2026-07-02

Rejected: shipping a Whetstone-owned engram-equivalent — embeddings, a database, an index.
That is a separate product, and building it risks shipping neither the memory engine nor the
retro loop that is the actual thesis. Also ruled out: forking or hard-depending on engram, and
semantic search before the loop earns it. The core stays fully functional on files and grep.

A 2026-07-11 survey of four backends (Basic Memory, mem0, Letta, the reference MCP `memory`
server) refined rather than reversed this. It ruled out `summarize` as a per-adapter
passthrough — not one backend exposes prose synthesis, so it is core-owned as
`render(search(scope))`. It ruled out mem0 as the first adapter after files (it rewrites
stored text by default), and deprioritized Letta (stateful-agent tax) and the reference graph
server (no time axis, so `since` cannot be expressed).

### adr-0002 — the definition directory is the source; vendor files are rendered from it
`accepted` · 2026-07-06

Ruled out: deriving `.wst/` FROM a vendor file. Vendor files are always outputs, never
inputs. Ruled out with it: staying mono-vendor — the workspace this generalises had a
bootstrap script writing `CLAUDE.md` only, and Whetstone puts pluggable emitters behind it
rather than adopting that shape.

Settled here and nowhere else: the V0 emitter writes **both `CLAUDE.md` and `AGENTS.md`**,
which covers most agents for the least surface. Additional emitters (`.cursor/rules`, …)
sit behind the same seam.

*By adr-0017's bar the first paragraph would be a commit message today: nobody proposed the
other direction. It is kept because five other decisions cite it.*

### adr-0003 — human-gated auditable evolution, not autonomous optimization
`accepted` · 2026-07-06

Rejected: autonomous rule rewriting — the Cursor Bugbot model, which learns from PR-review
signals with no human gate, keeps rules in a UI rather than in git, and carries no
rule→signal provenance. Rejected with it: the autonomous-optimizer class (DSPy, Reflexion).
The human gate is the moat, not a limitation.

Pre-registered kill criterion, recorded so it cannot be rationalised away: after dogfooding
the full loop on one real project, if the retro proposes nothing a human actually wants to
accept — nothing that beats doing it ad hoc — the thesis has failed.

### adr-0004 — the payload is the value; the installer is a wrapper
`accepted` · 2026-07-11 · signals: sig-0001

Rejected: building the CLI or plugin first. A polished installer around miscalibrated skills
is worthless, and it packages a payload nothing has validated — `sig-0001`'s error exactly.
Ruled out with it: a payload that reaches back to Whetstone's own files, which dangles the
moment it lands in another repo.

adr-0008 narrowed the ordering rule's scope, not its reasoning: discharged for `init` and
`retro`, explicitly waived for the gate, registry, triage and receipts.

### adr-0005 — the emitter is a compiler; the code tier is V1
`superseded by adr-0022` · 2026-07-13 · signals: sig-0001

Rejected: building Whetstone *as* a Claude Code plugin. It would vendor-lock the tool itself,
which is the thesis inverted; a plugin may be a distribution wrapper, never the identity.
Rejected: spraying code-tier artifacts at init, which copies a mature workspace's shape
without the knowledge that earned it. Rejected implicitly, and worth stating: parity across
vendors. Cross-vendor is FULL at the markdown tier and PARTIAL at the code tier — each vendor
gets the richest apparatus it can natively express and the emitter degrades where a tool has
no equivalent (Cursor gets no hooks). Claude Code is the first code-tier target because its
apparatus is the richest.

The 2026-07-14 amendment rules out the over-reading of that second rejection: a *foundational*
hook compiled from triage rules the human authored minutes ago is not a guess, so it may ship
at init. Only *graduated* apparatus — earned when the signal log proves an advisory rule is
ignored — is withheld.

Reversal: if per-vendor compilation proves unworkable at the code tier, vendor-lock returns to
the table — after a Wizard-of-Oz run proves it, not before.

### adr-0006 — update by 3-way merge against a recorded base
`accepted` · 2026-07-13 · unbuilt

*Half in force since 2026-08-22. `init` records the base and `wst update` reports what
changed against it; nothing merges yet. This entry's own reversal clause — "fall back to
reporting drift and letting a human re-copy" — is what the report half is, so the merge is
earned by a report that proves it is needed rather than assumed.*

Rejected: reference/extends models (ESLint shareable configs, Terraform modules, git
submodules). Each needs a live dependency inside the target repo, which breaks the
self-contained payload. Rejected as anti-models: eject (one-way copy, no path back) and
cookiecutter (no update at all). Rejected: importing copier's Python engine, when `git
merge-file` is already assumed by a git-native tool.

Also ruled out: treating the two asset tiers alike. Hand-editable files merge; emitter output
is RECOMPILED, and a hand-edit found there is drift to flag, not content to reconcile.
`constitution.md` is never auto-touched at all.

Reversal: if 3-way merge on prose produces conflicts too often to be worth the machinery, fall
back to reporting drift and letting a human re-copy.

### adr-0007 — a decision amends by status, never by editing accepted prose
`superseded by adr-0019` · 2026-07-14 · rules: retro.md

Rejected: amending a decision by rewriting its text. The audit trail is the whole point — a
record that can be edited is not evidence of what was believed. Rejected: letting the retro
flip a status on its own; it detects and proposes, a human confirms. The constitution is
exempt from both: it is the human-owned root, not a decision with alternatives.

adr-0019 supersedes the deletion half and keeps the rest: the status mechanism, the no-rewrite
rule, and the constitution's exemption all still stand.

### adr-0008 — build the TS engine, and name the waiver rather than imply it
`accepted` · 2026-08-07 · signals: sig-0001 · rules: triage-rules.md

Rejected: waiting for a second validated retro before writing any code. The second retro needs
signal volume, volume needs the loop running against real work, and the Wizard-of-Oz procedure
is too expensive to run often — the rule perpetuates itself. Rejected: wrapping only the
validated halves (`init`, `retro`) and leaving the gate as markdown, which ships the commodity
half first and inverts the value. Rejected: building everything and declaring adr-0004
satisfied — the silent supersession adr-0007 exists to forbid, which is why the waiver is
written down.

Pre-registered kill criterion: one lens, one known-good and one known-bad fixture, N=10 runs
each. To earn `block` a lens must be correct and unanimous — 10/10 on both, zero flips.
Stability alone is not the bar; a lens that stably passes everything is stable and worthless.
If no lens clears it, the gate degrades to deterministic checks, which is commodity CI, and
the differentiator is gone — stop and reconsider rather than proceed.

Also settled here: Whetstone takes light orchestration and delegates everything commodity.
It is not a fleet manager, not a spec framework, not a memory server.

### adr-0009 — delete `wst pr`; the gate's exit code is the only channel Whetstone owns
`accepted` · 2026-08-09

Rejected: fixing `tierFloor(strict)` to `skip`. Cheapest, and it yields a correct annotation
that is almost always empty — 2,881 lines that emit nothing is worse than none. Rejected:
earning the 🟡 only where a strict file has no check covering it. Genuinely informative, and
the best repair available, but it keeps 18% of the project alive on a bet that the lens gets
calibrated. Rejected: keeping it and calibrating first — the honest sequencing, refused
because the lens had already failed the bar once on false positives and the wait is
open-ended. Rejected for now, not forever: emitting reviewdog's format and letting a mature
tool render — the criticality rule is 100 lines, the 2,700 around it is transport reviewdog
already owns.

Cost accepted: Whetstone says nothing *inside* a pull request. A reviewer gets pass or block
and no map of where to look.

Reversal: if the `correctness` lens earns a receipt and produces findings a human agrees with,
criticality becomes informative again — rebuild it over reviewdog's format, not as a forge
client.

### adr-0010 — publish the binary to npm; the plugin carries the session-side layer
`proposed` · 2026-08-09 · signals: sig-0029

*Deliberately sequenced after the gate proves itself. Not in force.*

Rejected: `npx wst` alone — it solves distribution and leaves `init` replacing a target repo's
`.claude/settings.json` wholesale, which is the half that actually hurts. Rejected: npm plus
keeping the emitted hook, which strands every hook fix in every repo nobody re-inits. Rejected:
dropping the strict-path hook entirely — it warns at the moment of the edit, the one moment
the gate cannot reach. Rejected: plugin-only, which puts the binary out of reach of CI, where
the gate matters most.

Refused separately: writing a CI workflow into a repo Whetstone does not own. The host's own
CI runs the same commands already; a second workflow buys a second name for one verification.
What Whetstone owes that repo is an answer to whether the CI it has covers what the gate
requires. Cost accepted, plainly: in a host repo the gate then lives in a pre-push hook, and
`--no-verify` skips it.

### adr-0011 — build the event log; refuse the workflow engine
`superseded by adr-0024` · 2026-08-09

Rejected: the YAML workflow engine with branching and `goto`. It reimplements state machines
Temporal, LangGraph, Dagger and GitHub Actions already own, and branching destroys the one
thing here that is trustworthy — `aggregate.ts` is 88 lines of fold with no I/O and no
configuration. It also adds thousands of lines to a project that removed 2,881 the same day
for being more than one person could hold.

Rejected: a directory refactor to `core/ | agents/ | evaluators/ | memory/`. That separation
already exists as pure core plus shell adapters with ports passed as parameters; renaming
costs a day and buys nothing. Rejected: keeping `wst run` and growing it into the
orchestrator — worktree dispatch is commoditised (Vibe Kanban, container-use, Conductor,
firstmate, and Claude Code's own worktrees) and cannot be the differentiator. Rejected, but
only just: going straight to distribution.

Cost accepted: Whetstone gives up the visible, demo-able half — running your agents — and
keeps measuring them.

### adr-0012 — do not claim generic vocabulary in a repo you do not own
`accepted` · 2026-08-10 · signals: sig-0042 · rules: skills/doc-locations.md

Rejected: supporting `.sdd/` and `.wst/` together for compatibility. Five commands would have
to decide which wins, and a repo holding both has no source of truth — indeterminacy is the
thing this project exists to remove. Rejected: making the directory name configurable, twice
over — `wst.yaml` lives inside the directory it would name, and configurability forces every
generated-prose site to interpolate the value. Rejected: keeping the name and documenting the
collision; the reader who needs that document is the one who will not read it.

The constraint is the decision and the name is its consequence: if `.wst` collides with
something equally established, only the name changes.

### adr-0013 — `wst plan` is the front door, reads a plan, and never blocks
`superseded by adr-0023` · 2026-08-12

Rejected: the README's design — a step inside `wst run`, for critical changes only. Its host
was being removed, and gating on criticality inverts the value: the moment a plan is worth
checking is *before* anyone knows how critical the change is. Rejected, and this is the
load-bearing one: having the engine WRITE the plan. That puts an LLM in the engine for
something that is not irreducible judgment, and it takes the one step the human explicitly
wants to keep. Rejected: doing nothing because the charter already lists the checks — it lists
them at dispatch, after the approach is settled, and the question is asked while the approach
is still negotiable. Rejected again, per adr-0011: a workflow graph.

Cost accepted: a plan declares its own paths, so the tier it reports is a PREDICTION. The
ground truth exists at the other end — `wst gate` classifies the real diff — so the front door
cannot be routed around, because it was never doing the enforcing.

Reversal: if the predicted tier diverges often enough that nobody reads it, delete it rather
than tune it.

### adr-0014 — split `wst run`: keep the briefing, drop the dispatcher
`superseded by adr-0023` · 2026-08-12 · signals: sig-0041

Rejected: executing adr-0011's "remove `wst run`" literally. That argument is about
commoditised dispatch, so it reaches `shell/crewmate.ts` and not `core/dispatch/charter.ts` —
and `sig-0041` is the evidence that a briefing rendered from the live registry catches errors
a hand-written prompt does not. Rejected: keeping the command whole; the dispatcher is process
babysitting behind a 30-minute timeout that emits nothing for its duration. Rejected: adding
`wst clean` to reap worktrees — it trades one responsibility for another and keeps the
dispatcher; reaping belongs to whoever holds the lease. Rejected: renaming only.

Cost accepted, bluntly: no automatic gate on a crewmate's result. Enforcement is the push and
CI, so **a crewmate that never pushes is never gated.** Acceptable only because abandoned work
does not land, and landing is what the gate guards.

Reversal: crewmates routinely producing work that never reaches a push.

### adr-0015 — a plan lives behind the memory interface and predicts rather than binds
`proposed` · 2026-08-12

*`MemoryPort` does not exist yet. Not in force.*

Rejected against a stated preference, and recorded in full because it is what this would
reverse to: committing the plan under `.wst/plans/`. It is the only shape where the contract
binds in CI, because the plan travels with the change. Rejected outright: storing in engram
directly — a hard dependency on one backend, which the constitution forbids. Rejected: making
the plan a blocking contract now; it cannot bind where enforcement runs, so it would block
only on the machine that already knows the plan and pass silently everywhere else — a check
whose strictness depends on who ran it. Rejected: leaving the plan wherever the user points,
which is a hard dependency wearing a config flag.

Bounded deliberately, because a port with no consumer is this project's named scope trap:
declare three verbs, implement two, and let `summarize` throw rather than return something
plausible. The four existing file adapters are not migrated behind it.

### adr-0016 — `init` reads declared facts and stops inferring conventions
`accepted` · 2026-08-13 · signals: sig-0041

Rejected: deleting `detect.ts` and `walk.ts` entirely and letting an agent read the repo. The
largest cut and the most on-thesis, refused because it makes `init` unusable without a model,
and because an agent asked for the test command may paraphrase it — and a paraphrased command
is a check that runs the wrong thing. Rejected: freezing `init` and cutting nothing; 29% of
the project frozen is still 29% of it to read. Rejected: deleting `init` outright and
bootstrapping by hand — `selfcontained.ts` and `collisions.ts` are real enforcement, and
hand-copying loses both. Rejected: keeping detection and growing `--propose` alongside it, the
worst of both — two paths to one answer, drifting.

Cost accepted: a repo with no judge gets blanks where the tables used to guess. A blank a
human fills beats a table's confident wrong answer (`sig-0041`).

Reversal: if the asked-for answers are the ones people skip, the guess was carrying more
weight than it looked.

### adr-0017 — an ADR records a rejected alternative; one page says what is true now
`accepted` · 2026-08-14 · rules: skills/recording.md, skills/doc-locations.md

Rejected: keeping the practice unchanged — `supersedes: null` in all seventeen files and a
nine-deep citation web is cost with no reader, and this project already deleted `wst pr` for
producing output nobody could use. Rejected: deleting the decisions and trusting git — a
decision NOT to do something has no commit, so it has no home in history and gets re-litigated
every few weeks, which is what adr-0011 exists to stop. Rejected: generating a current-state
page from the decision files, which makes them load-bearing forever and turns a documentation
problem into a compiler. Rejected: a wiki, or a page rewritten in place with no record — the
rejected options vanish, and they are the content.

So: an ADR records a decision that rejects an alternative. `.wst/architecture.md` is the single
statement of what is true now, present tense, never arguing, and checked the way `AGENTS.md`'s
counts are.

Explicitly out of scope, and left for adr-0019: the seventeen files already on disk.
*"Narrowing what earns an ADR is not the same as making the ones we have editable."*

### adr-0018 — a verification method is a third kind in the registry, and it never blocks
`accepted` · 2026-08-14 · signals: sig-0041

Rejected: a separate registry under `.wst/methods/`. The obvious shape, and it duplicates the
whole of the check file — globs, `tiers`, `origin`, `version`, `enabled` — so every consumer
asking "what applies to these paths" would merge two registries through two loaders that can
disagree. The selection machinery is the expensive part and it already exists. Rejected: a
field on a triage rule, on precision — triage is first-match and coarse, and a change touching
a component and its API client legitimately earns two methods. Rejected: prose in a skill,
which is where this lives today; a skill is not selected by changed paths, so nothing can
answer "which method applies to *this* diff" at the moment it is needed. Rejected twice over:
making a method executable — letting the gate drive the browser is the workflow engine
adr-0011 refused, and letting an agent return a pass the gate consumes is a self-reported pass
compiled into an exit code, which is a lie the gate would then carry. Rejected: doing nothing
and letting the human say how to test it per task — unversioned, uncited, and unamendable from
evidence, which is the whole point.

Cost accepted: the only new verification surface added in months is one the gate cannot
enforce. Taken over an enforcement story that would be either a lie or a second execution
engine.

Reversal: if methods accumulate and no report ever cites one, delete them — do not add a lens
that judges whether the method was followed.

### adr-0019 — the decision record may be compacted, keeping the rejected alternative
`accepted` · 2026-08-14 · supersedes adr-0007 · rules: skills/recording.md

Rejected: keeping adr-0007 unchanged and consolidating anyway — that is hard rule 6 as
advisory, in the one place the project is least able to afford it. Rejected: keeping adr-0007
and never consolidating, the honest status quo, refused on the measurement: 89% of the corpus
was context and consequences that either landed in the code or belong in `architecture.md`,
and the mechanism protecting it had never fired in eighteen files. Rejected: deleting the
record entirely and trusting git, for adr-0017's reason — a decision NOT to do something has
no commit. Rejected once it was tried: compacting but dropping `status`, which deletes
adr-0007's only sanctioned amendment mechanism in the same change that uses it, and leaves
`core/retro/propose.ts` shipping a `flip-adr` recommendation with nothing to flip.

The argument adr-0007 never made: **git is an audit trail.** adr-0007 protects the text as if
the filesystem were the only record, and does not mention git once. Every deleted line comes
back with `git log --diff-filter=D`, with author and date. What git cannot reconstruct is the
*argument* — a diff shows a decision was made, not what it was made against — so that is what
an entry keeps.

Cost accepted: a reader who wants the full reasoning behind a decision runs a git command
instead of opening a file. Taken because the measurement says almost nobody opened the file
and everybody paid for it.

Reversal: if a compacted entry turns out to have dropped the thing someone needed, and git
history was not consulted because nobody thought to, then this page is a summary rather than a
record, and the full files should come back.

### adr-0020 — the judge authors the payload's judgment; the engine refuses what does not hold together
`proposed` · 2026-08-14 · signals: sig-0041

*Not in force. `init` still renders every file it writes.*

*Compacted 2026-08-22 (adr-0019): the measurement breakdown, the enumerated minimum, and the
two origin-payload measurements are dropped. Full text in git.*

**The measurement first, because it reverses the reason this was raised.** `init` was asked to
shrink by moving generation to the model. Split by who can legitimately author each file, only
248 lines are judgment; the other 301 are contract. **Net: roughly 108 lines.**

So this is not a size decision, and arguing it as one is how it gets accepted for the wrong
reason and reversed on the first inconvenience. It is a decision about **who authors
judgment**: a template that says "a bug here is expensive" the same way in every repo is a
template nobody reads, and it cannot be amended from evidence.

- **Rejected: cutting the renderers for the line count.** 108 lines is not worth a dependency
  on a model.
- **Rejected: letting the judge write everything, contract files included.** An agent asked for
  the test command may paraphrase it, and a paraphrased command is a check that runs the wrong
  thing. The same argument covers the signal schema and the decision page's format, which are
  read by code that will not tolerate a synonym.
- **Rejected: leaving `init` unusable without a judge.** Without a judge it degrades to a
  minimum: `triage.yaml`, one or two deterministic checks seeded at `warn`, and genuinely empty
  memory. Not the eight skills. **A blank a human fills beats a template's confident wrong
  answer**, which is adr-0016's own accepted cost.
- **Rejected: shipping the rules as always-on payload — and this one was RUN, not reasoned.**
  The workspace Whetstone generalises spent five weeks with 807 lines always in context and
  reversed to 161 loaded by trigger, **80% less**. The criterion is the transferable part:
  **conditionality, not importance.**
- **Rejected: treating the origin payload as transferable.** **A payload is not a thing you
  copy; it is a thing a project earns.**
- **Rejected: keeping both paths — templates when there is no judge, the judge otherwise.** Two
  ways to produce one artifact, drifting, which is the defect class this repo has found six
  times. The minimum is deliberately NOT a smaller template: it is blanks.
- **Rejected: the judge writes the payload and `init` trusts it.** The engine keeps the
  manifest, reference closure, the collision check and the loaders, and refuses a draft that
  fails any of them.

Cost accepted: `init` gains a second mode, and the two produce different-quality payloads from
the same repo.

Reversal: if the drafted payload needs as much human editing as the blanks did, the judge was
adding a step and not judgment — delete the mode and keep the minimum.

### adr-0021 — "nothing covers this" is not "the gate broke", and must not block
`accepted` · 2026-08-17

Hard rule 3 enumerates what counts as a check that could not RUN: spawn, budget, timeout,
auth, invalid output. **"No check matched these paths" is not on that list** — nothing broke,
nothing was attempted. `outcomeOf` collapses the two into `incomplete` anyway, so both exit 2,
and a pre-push hook blocks on both.

The consequence, reported from a day of use in a repo Whetstone does not own: a change touching
only markdown has **no legitimate way through the gate.** That report's own signals live in that
repo's log, not this one, so there is no local id to cite — the evidence is the behaviour, which
reproduces here on any clean tree. The seeded checks watch `src/**`; a README edit matches none of them,
so the gate reports the gate is broken and refuses a push that nothing was ever going to
verify. There is no edit the author can make to fix it.

- **Rejected: leave it.** It is the exact pressure this project names everywhere else — a gate
  that blocks what nobody can fix teaches `--no-verify`, and a routed-around gate stops
  catching the real findings too. Recorded because it is no longer hypothetical: on
  2026-08-17 an amend that changed **only a commit message** produced an empty range, and the
  author of this entry ran `--no-verify` on Whetstone's own hook rather than fight it. Third
  time that day the same conflation blocked a change nothing was going to verify. Whetstone deleted `wst pr` for producing output nobody could
  act on; this produces a refusal nobody can act on.
- **Rejected: make the hook special-case exit 2.** It only sees an exit code, and the two
  situations it would have to tell apart are exactly the two this conflates. Pushing the
  distinction to every consumer of the CLI is the wrong end.
- **Rejected: seed a catch-all check so everything is covered.** A check that matches every
  path in order to keep the gate quiet verifies nothing and reports a pass — which is the
  failure adr-0009 deleted a whole command over.
- **Rejected: exit 0 silently.** "Nothing was verified" may never read as "verified". The
  distinction is the message, not the absence of one.

**A fourth outcome, `uncovered`: report it loudly, exit 0.** The run says in its own words
that nothing here was checked, and names the paths, which is what `wst plan` already reports
as its fourth output. It does not block, because there is no action behind the block.

Cost accepted, and it is the uncomfortable half: a repo can push a change no check looked at,
and CI reading only the exit code sees green. That is true today as well — the difference is
that today it is *also* true for changes the gate genuinely failed to verify, and those two
being indistinguishable is worse than either.

Reversal: if `uncovered` becomes the normal result rather than the rare one, the coverage is
the defect and the answer is checks, not a louder message.

### adr-0022 — `triage.yaml` is the source; the table is documentation
`accepted` · 2026-08-19

Rejected: building the compiler adr-0005 described — markdown table in, YAML out, plus a
check that they agree. It would add a compiler and a check to keep in sync a page nothing
reads, while the pair that actually decides anything (`DEFAULT_RULES_YAML` ↔
`triage.yaml`) is already pinned byte-for-byte by `test/triage-defaults.test.ts`.
Rejected: deleting `triage-rules.md` — a human-readable statement of what each tier means
is worth keeping, and it is where the retro amends the *reasoning*. Rejected: leaving it,
which is what produced the drift.

adr-0005 was right when it was written: the table compiled to
`.claude/hooks/strict-path-guard.mjs`, and that hook was real. adr-0010 removed the hook.
Nothing has compiled the YAML from the table since, and the two diverged — the page omitted
`src/commands/**`, `src/cli.ts` and `docs/**`, all of which the engine enforces. A declared
source nobody parses is worse than no declaration: a reader edits it and expects an effect.

What survives from adr-0005: the emitter-as-compiler shape for everything it still compiles,
and the refusal to build Whetstone *as* a vendor plugin.

### adr-0023 — cut `plan` and `prepare`: the definition travels, so nothing needs to carry it
`accepted` · 2026-08-20

Supersedes adr-0013 and adr-0014. Both built a seam between a human's intent and the work:
one predicting what would judge a change before it existed, the other writing a briefing into
a leased worktree. Neither survives the question of who reads them. `.wst/` is committed and
travels with the repo, so any worker that can read markdown already has the rules; a charter
is a second copy of them, and a second copy drifts from the first.

Rejected, and it is the strongest argument against this: that `prepare` is the only place
standards reach an agent BEFORE it writes code, and without it Whetstone becomes a post-facto
gate that an agent discovers only by failing, burning tokens in trial and error. Refused
because the premise is wrong about how a coding agent takes rules — it reads the workspace,
and `.wst/` is in the workspace. The briefing solved a problem that `init` writing the
definition into the repo had already solved.

Rejected: keeping `plan` for the one thing it alone answered, "which of the paths I intend to
touch does nothing cover". adr-0021 gave the gate an `uncovered` outcome, which reports the
same fact where it can act on it rather than where it can only predict it.

Rejected: cutting `check` and `triage` in the same breath, on the ground that they hold zero
exclusive engine code. They are 122 lines of wiring over functions the gate calls anyway, and
they are the only way to ask "what will judge this file" without running the gate. Deleting
them saves no engine and removes the diagnostic.

Deferred, NOT rejected: `events`. Cutting the reader means stopping the gate from writing the
log, which is surgery on the one command everything else depends on. It is a separate change
with a separate blast radius.

Cost accepted: `assertWorktreeAt` goes with `prepare`. It was the guard `sig-82dec46b` earned
— a destructive command asking where it is standing — and it had no other caller. Anything
that later runs git against a directory it did not open must bring it back.

### adr-0024 — stop writing a log nobody reads
`accepted` · 2026-08-21

Takes only the first half of adr-0011. **The refusal of the workflow engine stands** and is
untouched; every rule that cites adr-0011 for that reason still resolves to it.

The event log had exactly one reader, `wst events`, and that reader existed to explain the
log. It was gitignored, so it never left the machine that wrote it, which is why the run CI
recorded evaporated with the runner. What it was for -- knowing which check was slow, and
whether a run ended the way the console said -- is served live by the progress lines the gate
already writes to stderr, and permanently by the signal log, which is committed.

Rejected: keeping the writer and cutting only the reader. That leaves the gate spending disk
and code on a file with no consumer, which is the same defect with fewer symptoms.

Rejected: committing the log instead of ignoring it, so it would accumulate across machines.
It is per-run state that changes on every push; committing it leaves the tree dirty
immediately after the pre-push hook runs, and a team would resolve a conflict per push in a
file no decision reads.

Cost accepted: a run no longer prints an id, so two people comparing runs have the console
output and nothing else. And an outcome is now asserted through what the gate prints rather
than through a record of it, which is a weaker test of the same guarantee.

### adr-0025 — `init` may propose an opinion, but never seed one unasked
`superseded by adr-0030` · 2026-08-21 · signals: sig-4a2610fb, sig-ea119c62

*In force since 2026-08-22. The interview asks a seventh question, nothing is
pre-selected, and a model may not answer it.*

*Cost paid down rather than up: this entry accepted "one question per opinion". One
multi-select costs less and holds the count at seven however many ship.*

adr-0016 left `init` reading only what a repo DECLARES: its scripts, its lockfile, whether
test files exist. That rule was written against inference -- a table guessing a language from
file extensions -- and it has held. It does not answer a different question that has now
arrived twice: what to do with a rule that is generic, earned by evidence, and declared by
nobody.

Two exist already. `comment-density` came from `sig-4a2610fb`, a rule stated twice and
regressed anyway. A guard on commands that discard uncommitted work came from `sig-ea119c62`,
an hour of work lost to `git checkout`. Neither is inferable from a repo, and both are as true
in a payments API as here.

The rule: an opinion may be OFFERED in the interview, named, with the friction that earned it,
and it is written only if the human says yes. It is never written by default. A declared fact
still needs no question.

Rejected: seeding them silently. A repo that gains a blocking check nobody asked for is the
"pile of config from guesses" that adr-0016 exists to prevent, and the fact that this guess
happens to be right does not change what it teaches.

Rejected: keeping them out of the payload entirely and leaving them as Whetstone-only checks.
That is the position adr-0016 implies, and it is what stops the loop from paying out: friction
found here would sharpen only this repo, when the whole thesis is that a rule earned once
travels.

Rejected: a `--opinions` flag instead of a question. A flag is answered by whoever typed the
command fastest; the interview is the one place a human is already reading and deciding.

Cost accepted: the interview grows by one question per opinion, and an opinion nobody accepts
is dead weight in the payload. Six questions was already the number adr-0016 settled on, and
this reopens that budget.

### adr-0026 — two judges report, they do not vote
`accepted` · 2026-08-21

*In force since 2026-08-22: a check carries its own `agent:`, and the gate resolves a
judge per check. Whether a repo runs two is its own choice; the rule for how they
coexist is enforced.*

`LlmJudge` had one adapter, which made vendor-agnosticism a claim rather than a seam. A second
adapter raises a question one adapter never had to answer: what the gate does when the judges
disagree.

The rule: each judge is its own check, with its own severity and its own calibration receipt.
They do not vote and they are not merged. Two `warn` lenses that disagree produce two lines a
human reads.

Rejected: AND -- block if either fails. It multiplies the false-positive rate, and neither
lens has passed calibration, so this ships the worst property of both.

Rejected: OR -- pass if either passes. It lets a change route around a judge by finding the
laxer one, which is the routed-around gate that has negative value.

Rejected: merging them into one verdict behind one check id. A calibration receipt binds a
lens hash, a model and a runtime; a merged verdict has no single one of those to bind, so it
could never earn `block` under non-negotiable 2.

**Which judge runs by default follows the harness**, because a judge without credentials is a
check that cannot run at all: inside Claude Code the default is `claude`, inside Gemini CLI it
is `gemini`. Cross-vendor judging -- the reviewer being a different model from the author --
is the reason to override it, and remains an explicit choice.

An absent CLI is `errored`, never `fail` (hard rule 3), and an errored `warn` check blocks
nothing. That is what makes a second judge free to offer: where it cannot run, nothing happens.

### adr-0027 — `correctness` blocks in CI, never in the hook
`accepted` · 2026-08-25 · unbuilt

*Not in force since 2026-08-27: CI runs `--no-lens` (f5a4bd7), because a runner has no
OAuth session and the lens errored on every run without an API key. The hook skips it by
design. The block has nowhere left to fire, so the lens runs only when a human runs it.*

The lens measured 100/100 on 2026-08-25: unanimous on all ten fixtures, six of them `hard`,
zero flips, zero harness errors, on claude 2.1.241. The receipt authorises `block`, and
non-negotiable 2 has nothing left to refuse. `severity` moves from `warn` to `block`.

Rejected: staying at `warn` because the fixtures are synthetic. They are, and the
false-positive rate on real diffs is unmeasured. But an advisory lens cannot produce the
evidence that would settle it: at `warn` a false positive is a line in a log nobody reads.
Staying advisory is choosing never to find out, and this repo is the cheapest place in the
world to find out -- one author, no team to interrupt.

Rejected: arming the lens in the pre-push hook as well. The hook's own reasoning holds: a
gate that costs fifty seconds and real money on every push gets bypassed with `--no-verify`,
and a routed-around gate is worth less than no gate. CI is where the cost is invisible and
the bypass is visible.

Rejected: requiring N more clean calibrations before promoting. The bar was pre-registered at
one passing run (adr-0008). Raising it after seeing a pass is fitting the bar to the result,
which is the only thing that made the measurement mean anything.

Cost accepted: a false positive on real work is now a red PR, and the temptation to route
around it lands on the one person who can. The receipt binds a lens hash, a model and a
runtime, so editing the lens or upgrading the judge drops the authorisation and the check
refuses to load at `block` until it is re-measured. And the two harness failures of
2026-08-20 were never diagnosed. They did not recur, but nothing was fixed.

### adr-0028 — a command that runs for minutes reports progress, and silence is the bug
`proposed` · 2026-08-27 · sig-b828c2b1

Completes adr-0024 rather than reversing it. That decision cut the event log on the ground
that what it was for is "served live by the progress lines the gate already writes to
stderr". The reasoning holds. What it did not notice is that only `gate` writes them:
`retro` and `calibrate` emit nothing between the command and its result, and both run for
minutes. Measured here: `gate.ts` has eight progress call sites and a pure
`core/gate/progress.ts` behind them; `retro.ts` and `calibrate.ts` have none.

The cost is not aesthetic. A run that says nothing is indistinguishable from a run that
hung, and a human resolves that ambiguity by killing it. Twice a `wst retro` of about
twenty minutes was killed on the belief it was stuck, and a calibration spending real money
gave its operator no way to tell whether it was advancing. Both reports are from the field
and from different people, which is more evidence than adr-0024 had when it decided the
gate's lines were enough.

So: **`retro` and `calibrate` report through the same port `gate` uses.** Phase, item and
elapsed time, on stderr, so a pipe still carries only the result.

Rejected: restoring `wst events --follow`. It would reinstate the writer adr-0024 removed
for having one reader, and it answers the question in the wrong place: a second process
reading a file, when the running process already knows.

Rejected: a spinner. It proves the process is alive and nothing else. The two failures here
were people deciding a run was stuck; what settles that is which item is in flight and for
how long, which is what `gate` already prints and a spinner cannot.

Rejected: leaving `calibrate` out because it is a script rather than a command. It is the
longest-running thing in the repo and it spends money per call, so it is the worst place to
be silent.

Cost accepted: two more call sites that can drift from what the run actually does, and
stderr output in a script whose stdout some caller may parse. The port is shared, so the
drift is one module wide rather than three.

### adr-0029 — this repo's CI runs the checks, and `wst` says whether they cover the change
`proposed` · 2026-08-27

adr-0010 refused to write a CI workflow into a repo Whetstone does not own, on the ground
that "the host's own CI runs the same commands already; a second workflow buys a second
name for one verification. What Whetstone owes that repo is an answer to whether the CI it
has covers what the gate requires." That reasoning was never applied here, because this
repo is its own host, and `gate.yml` runs `wst gate` as the whole job.

What that costs came due on 2026-08-26. `correctness` earned `block` (adr-0027), the runner
has no credentials, and hard rule 3 correctly reports a blocking check that could not run as
exit 2. So **every pull request touching `src/**/*.ts` went red while typecheck, test and
lint all passed.** The tool had become the check rather than the thing that says which
checks apply.

So: **CI runs the commands, and `wst` reports coverage beside them.** A failing typecheck
fails because typecheck failed, named as itself. `wst triage` says what tier the change
earned and `wst gate --no-lens` reports what applied, as information rather than as the job's
verdict.

Rejected: leaving `--no-lens` in the gate invocation and calling it done, which is what
2026-08-26 shipped as an unblock. It works and it hides the question: the lens then runs
nowhere at all, and the `block` it measured 100/100 for is authority it never exercises.

Rejected: wiring `ANTHROPIC_API_KEY` and keeping the gate as the job. It fixes the red
without answering whether one command should be able to fail a run whose every deterministic
check passed. Worth doing on its own terms, and it is a bill per pull request.

Rejected: dropping the lens to `warn` again. That spends a measured calibration to buy a
green tick.

Cost accepted: the CI file stops being a demonstration of `wst gate`, which was part of why
it looked right. Dogfooding the gate moves to the pre-push hook, where a human is present
and authenticated, and that is the one place the lens could actually run.

### adr-0030 — a check Whetstone brings is a check, and it arrives switched off
`accepted` · 2026-08-27 · signals: sig-4a2610fb

adr-0025 gave the rule its own noun. An `opinion` was a rule no repo declares, earned here,
offered in the interview and written only on a yes. It bought a catalogue module, a
`wst opinion` command, a seventh interview question and a word that answered "what is it?"
with "it is an opinion".

Every check already carries `origin`: the signals that earned it, empty where nothing did.
That field states the whole distinction. `comment-density` in this repo has said
`origin: [sig-4a2610fb]` since the day it was written, and nothing calls it an opinion.
One member, and the category was already redundant against the field beside it.

So: **`comment-density` is a check `init` seeds, `enabled: false`, with the signal that
earned it in its `origin`.** The offer moves out of the interview and into the file tree,
where it is read at the moment the friction arrives rather than on day one, when the
answer to "do you want a comment ceiling?" is "I do not know yet". `enabled: false` is
adr-0025's guarantee kept, not dropped: a check that never runs cannot block a change
nobody asked it to judge, which is the outcome that entry existed to prevent. The precedent
is already here: a mutating `lint` has been seeded off since adr-0016's install.

The runner survives the rename. A seeded check must name a command the target repo has, and
`npm run check:comments` names a script nobody wrote there. It is `wst check run <id>` now:
the same binary the check file already assumes, under the noun the thing actually is.

Rejected: keeping the question and renaming the noun. It holds the interview at six for one
shipped rule, and it asks for a decision at the moment the person knows least about the repo
they just pointed at.

Rejected: seeding it enabled and at `warn`. That is the "pile of config from guesses"
adr-0016 exists to prevent, and a warning nobody asked for is noise on the first run, which
is exactly when a gate is being decided on.

Rejected: dropping it from the payload and leaving it Whetstone-only. adr-0025 rejected this
already and the reason stands: friction found here would sharpen only this repo.

Cost accepted: `init` writes a file the repo may never turn on, which is clutter in a
directory whose whole claim is that everything in it is real. It is one file, it says on its
first line that it is off and what turns it on, and it is only seeded where a typecheck
script was declared, since the runner reads `.ts` files and nothing else.
### adr-0031 — bare `wst` opens a launcher, and the command it picks runs in the terminal
`superseded by adr-0032` · 2026-08-27

`wst` with no arguments printed its help, which is a list of nine things with no
indication of which of them this repo can do. A fresh clone and a fully bootstrapped one
got the same page.

So: in a terminal, bare `wst` opens a screen built from the same `StatusReport` that
`wst status` prints, with one row per command and the state beside it. `init` is
unavailable where `.wst/` already exists and says `update` instead; everything that reads
the definition layer is unavailable where there is none and says to run `init`; `gate`
stays available with no judge on PATH and says which half will not run. Picking a row
CLOSES the screen and runs the command in the terminal it was already in.

That last part is the decision. The command is unchanged: `gate` still prints a report a
pipe can read, `init` still opens its own interview, and the exit code is still the exit
code. What the screen does is choose one.

`wst signal` is deliberately not on it. It IS the [RC3] gate: behind a menu pick it
becomes a click, and a click is not an attestation.

Off a terminal the help prints exactly as before. A program that waits for a keypress in
a pipe or a CI job hangs where nobody can see it.

Rejected: running the command INSIDE the screen and rendering its output there. It makes
`wst gate` two different things depending on how it was started, and the one that matters
is the one a hook and a CI job run.

Rejected: a home that hides what it cannot run. A command that disappears reads as one
that does not exist, and the note saying what it is waiting for is the whole value over
`--help`.

Rejected: opening it whenever stdin is a TTY, ignoring stdout. A run whose output is piped
still has a terminal on stdin, and it would paint a menu into somebody's pipe.

Cost accepted: one more surface that can drift from what the commands actually do, since
the row descriptions are prose beside a dispatch table. Both live in one file and the
table is exhaustive over the command union, so a new command fails to compile until it
has a row.

### adr-0032 — the launcher comes back, and the one command that spends money asks first
`accepted` · 2026-08-28

adr-0031 stands except for its ending. The command still runs in the terminal rather than
inside the screen, still prints a report a pipe can read, still is the same function a hook
calls. What it got wrong is what happens after: the screen exited, so running `triage` and
then `gate`, which is the pair somebody actually runs, meant opening `wst` twice. Reported
three times in one sitting, once per command.

So: the run's output stays on screen until a key is pressed, and then the menu is redrawn
from a re-read status. The re-read is not a detail. `init` is the row that makes seven other
rows available, and a menu that came back stale would still be telling you to run it.

The exit code is SHOWN, not returned. Nobody scripts a menu, and the report on screen has
already said what happened; the number is there because it is what a hook would have seen.

And `wst retro` asks before it starts. It is the one command here that calls a model, once
per cluster, for minutes. From a command line you typed it; from a menu row it is an arrow
and an enter, surrounded by rows that cost nothing. The question names the model and the
number of calls. Skipped where stdin is not a terminal and by `--yes`, because a script
blocked on a prompt it cannot see is worse than the bill it was guarding.

Rejected: keeping the exit, and the reason is now measured rather than argued. Two of the
three commands reported as awkward were awkward for this and not for their output.

Rejected: returning the command's exit code from the launcher. It makes the code depend on
which row was picked last, which is a number about a session and not about a verdict.

Rejected: repainting the menu the moment the command returns. It is the same as not printing
the report, and it is exactly what `gate` must never do.

Rejected: putting the confirmation in the launcher rather than in `retro`. Then `wst retro`
typed out spends without asking and the same command has two behaviours, which is what
adr-0031 refused for `gate`.

Cost accepted: `wst` is now a session rather than a one-shot, so it holds a terminal until
somebody quits it. The reader is released on every handoff, which is the part that would
have broken `init` and `config`.

### adr-0033 — a setting is written when it is changed, and the row says what the command does
`accepted` · 2026-08-28

Three notes from one sitting of using the TUI, and all three are the same complaint: the
screen makes you guess.

**`wst config` writes on the keypress.** A checkbox that flips and then waits to be saved is
a checkbox that already looked done. The `s` key, the dirty flag and the confirm-on-quit
screen are gone; what replaces them is one line saying what was just written. The guard that
survives is narrower and real: picking the judge that was already picked writes nothing,
because a file rewritten with identical bytes is still a tool that touched a config nobody
asked it to.

**Every launcher row carries a detail.** `wst --help` already gives one line each, so a menu
that gives one line each is help with arrow keys. Under the cursor a row now says what the
command reads, what it writes, and what its exit code means. That is the launcher's whole
claim over typing the command: somebody choosing between `triage` and `gate` has to know
that one of them runs nothing and the other can block a push, and no page said so.

**`gate` gets ONE live line, not one per check.** adr-0028's heartbeat printed a new line
every ten seconds, which is proof of life and not a sense of progress. A spinner per check
was tried in an earlier version and reverted, and the reason is recorded in
`core/gate/progress.test.ts`: the deterministic checks run concurrently under one
`Promise.all`, so three of them rewriting the same line mangle each other. The line is
therefore owned by a single writer that knows the whole set: `running: test, typecheck
(12.3s)`, with each result printed above it as it lands.

Rejected: keeping the save key as well, for the person who wants a batch. Two ways to write
one file, and the one that does nothing until told is the one that loses work.

Rejected: an undo. Git is the undo, the file is tracked, and a second history of a
two-setting file is apparatus.

Rejected: hiding the detail behind a key. The information is the reason the row exists.

Rejected: giving each check its own line to animate. It is what the earlier version did, and
the test that documents its failure is still there.

Cost accepted: `config` can no longer be opened to look at without the risk of writing on a
stray keypress. It is two settings in a tracked file, and `git diff` shows what happened.

### adr-0034 — a report states a fact once, and `passed` says what stood behind it
`accepted` · 2026-08-28

Three commands were reported as confusing in one sitting, and the three had one defect
between them: a summary that repeated the list printed directly above it, and lines that
ran off the side of a default terminal.

**`gate` printed the bare word `passed`.** Over a run where two checks were skipped by
receipt and six matched no file, that is a verdict on a change nothing examined. It is not
wrong under adr-0021, which counts a receipt as verification, and it is unreadable: the
reader cannot tell a full run from an empty one. It now says `passed: 4 checks ran`, and
names the receipts when there were any. The `skipped:` line at the foot is gone; it
restated the per-check lines verbatim, id and reason.

**`check` printed `BLOCK` on every row and then listed the same ids under `may block`.**
The trailing line now appears only when the blocking set is a strict subset of the active
one, which is when it says something the column did not. Descriptions are clipped to the
terminal rather than wrapping into the next row.

**`triage` printed a `routing` block nobody could read.** `autonomy autonomous` is three
words that answer nothing: no line said where the values came from or what they decide. The
block now names the tier row that set them and says what each one governs. The path to
`triage.yaml` is relative, since the absolute prefix is identical on every line of every
run.

Rejected: cutting the long lines instead of wrapping them. What fell off was the half that
named what was missing, which is the only part worth printing.

Rejected: dropping the severity column from `check` and keeping the `may block` list. The
column is the one that stays useful as soon as two checks differ, and the list is the one
that goes silent.

Cost accepted: `renderRegistry` moved out of `src/commands/check.ts` into `core/`, so the
command and the page it prints are now two files instead of one. It is the same split
`gate` already has, and the page has tests it could not have had before.


### adr-0035 — the [RC3] gate is a human confirming their own words, not a TTY
`accepted` · 2026-08-27 · unbuilt

`source: "human"` has been earned twice in sixty-one signals. Not because the human observes
little, but because `humanIsAtTheKeyboard()` requires a TTY, and the way this human works is
inside an agent session where there is none. `commands/signal.ts` names the case in a comment
and accepts it. The mechanism built to mark human evidence marks almost nothing.

Worse than the label: today the agent notices the friction, PARAPHRASES it, and the human
types the paraphrase. The record ends up carrying the agent's prose about the human's
friction. That is a lossy translation, and it is part of why 47 of 53 signals read as
hand-authored prose.

The rule: an agent may DRAFT a signal from what the human actually said, quoting them
verbatim, and the human's confirmation is the gate. The evidence for `source` stops being
"a terminal existed" and becomes "these are the human's own words, and they said yes".

Rejected: letting an agent write signals unprompted. That is the failure `signal.ts` already
guards against, stated in its own comment: the cost of a false yes is an agent's line entering
the retro as first-class human evidence. Recurrence drives rule changes, so a fabricated
signal is a fabricated rule two retros later.

Rejected: keeping the TTY test and asking the human to leave the session to type. It is the
status quo, it produced two records, and it makes the correct action the inconvenient one.

Rejected: reusing `source: "human"` unchanged. A record drafted by an agent and confirmed by a
person is not the same act as a person typing it, and collapsing them would destroy the only
distinction the field exists to carry. This needs its own value.

Cost accepted: the confirmation is a weaker gate than typing, because a human confirms faster
than they compose. The mitigation is that the quote makes fabrication visible in the
transcript, which a paraphrase never did.

### adr-0036 — a check may require evidence of the result without judging it
`accepted` · 2026-08-27 · unbuilt

Every check here judges the DIFF. `test` runs the suite, `typecheck` compiles, `correctness`
reads the change. None of them says the thing works. A gate that passes tells you nothing
broke; it does not tell you what was built, so a human reviewing the PR still reconstructs it
from scratch.

The rule: a check may require that evidence of the RESULT exists, and the gate fails when it
is absent. What counts as evidence is declared per project by the same `include` globs every
check already uses: a UI change owes a screenshot, a new endpoint owes its request and
response, a migration owes the schema before and after, a pure refactor owes nothing beyond
its tests.

**Requiring is not judging.** The gate checks that the artifact is there. Whether the screen
looks right is the human's call at the end of the loop. Where the evidence is machine-readable
the check may go further and assert its shape, a status code or the fields the task promised,
and that stays deterministic.

Rejected: an agent-lens that judges the evidence. A lens over screenshots is a new judgment
check, and non-negotiable 2 means it may not block until it is calibrated against its own
fixture set. That is a separate project, and requiring existence delivers most of the value
for none of that cost.

Rejected: attaching the evidence to the PR. adr-0009 removed PR annotation deliberately, and
reopening it to carry an image is a large decision riding on a small one.

Rejected: committing the evidence to git. A screenshot per branch poisons the history of every
repo that adopts this, and the payload must not make a target repo worse (adr-0004).

Evidence lives beside the worktree, not in it: the check verifies presence and freshness, and
the agent reports the path. Nothing travels, nothing is published, and the whole thing can be
deleted if it does not earn its place.

Cost accepted: a required artifact that nobody looks at is ceremony, and the gate cannot tell
the difference. If evidence is being produced and never opened, that is a signal, not a
success.

### adr-0037 — `commands/` holds one export, and the guard blocks
`accepted` · 2026-08-28 · rules: checks/command-surface.md

adr-0008 named `commands/` composition roots: build adapters, call core, print. The same
page said policy has a home in `core/` rather than accreting in `commands/`, **which nothing
guards**, and both halves were true for two years. `core/` had `test/architecture.test.ts`
holding the import direction. `commands/` had nothing.

`command-surface` arrived at `warn` counting every export, which reported nine of eleven
files. Five of those nine were `interface *Options`: the command's own signature, erased at
compile time, read by `cli.ts` to type its own flags. A check wrong five times out of nine is
one people learn to skip past, so it counts BEHAVIOUR and not types.

That left four, and the four were real. `gate.ts` exported `createCheckRunner`, which spawns
processes and calls a judge. `init.ts` exported four helpers that read a repo and locate the
payload. `signal.ts` exported the two flag defaults. `status.ts` exported `gatherStatus`, and
that one is the shape stated plainly: `home.ts` needed the same facts, so one command
imported another rather than either reaching an adapter.

They are paid. `shell/check-runner.ts`, `shell/repo-facts.ts`, `shell/payload.ts` and
`shell/status.ts` now hold what read the world; `DEFAULT_PHASE` and `DEFAULT_SEVERITY` sit in
`core/signals/human.ts` beside the scale they belong to. Eleven of eleven pass, so the check
blocks: a deterministic check over a line that holds may block freely, and the reason this one
waited was that it was red rather than that it was uncertain.

Rejected: counting type exports and living with the noise. It is the failure mode the seeded
`lint` body already warns about in every repo `init` touches: a permanently-warning check is
noise, and noise is what makes the signal unreadable.

Rejected: letting a test import a second export "just for tests". Every one of the four was
reached for by a test rather than by another command, which is exactly how a thing that
belongs in another layer stops looking like a mistake.

Cost accepted: four more files in `src/shell/`, and `init.ts` and `status.ts` are now split
across two. `status.ts` is twelve lines and reads better for it; `gate.ts` lost 200.

