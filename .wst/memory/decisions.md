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
`accepted` · 2026-07-13

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

**The measurement first, because it reverses the reason this was raised.** `init` was asked to
shrink by moving generation to the model. Split by who can legitimately author each file, only
248 lines are judgment — the constitution's prose, `AGENTS.md`, the *reasons* on each triage
rule, and the seed checks' prose. The other 301 are contract: the signal schema, the decision
page's format, `triage.yaml`, `wst.yaml`. A paraphrased schema is the same defect adr-0016
named about a paraphrased test command, so those cannot move. Keeping skeletons for the
no-judge path costs ~40 of the 248 back, and a payload proposal needs a schema, a prompt and
validation — about 100 lines, on `propose.ts`'s existing shape. **Net: roughly 108 lines.**

So this is not a size decision, and arguing it as one is how it gets accepted for the wrong
reason and reversed on the first inconvenience. It is a decision about **who authors
judgment**: a template that says "a bug here is expensive" the same way in every repo is a
template nobody reads, and it cannot be amended from evidence.

- **Rejected: cutting the renderers for the line count.** The measurement above. 108 lines is
  not worth a dependency on a model, and the honest response to "make `init` smaller" is that
  `init` is not carrying much dead code — two unused exports and a barrel.
- **Rejected: letting the judge write everything, contract files included.** This is
  adr-0016's second objection and it still stands, unchanged: an agent asked for the test
  command may paraphrase it, and a paraphrased command is a check that runs the wrong thing.
  The same argument covers the signal schema and the decision page's format, which are read by
  code that will not tolerate a synonym.
- **Rejected: leaving `init` unusable without a judge.** This is adr-0016's *first* objection,
  and it is the one this answers rather than dismisses. Without a judge, `init` degrades to a
  minimum. One run against a real repo Whetstone did not own says what belongs in it:

  **`triage.yaml`, and `wst.yaml` only once something reads it.** Triage classified that repo's
  real diff correctly; everything else hangs off it.
  `wst.yaml` was in this list until it was checked: it is written by `plan.ts:141` and **read by
  nothing** — not a command, not an adapter, not a hook. Its only other readers are two asserts
  in its own test. So the file that declares which skills are active is consumed by nothing, in
  every mode, which is a stronger version of the field report's §B and independent of it. It
  belongs in the minimum when it has a consumer, and is an example of the problem until then.

  **One or two deterministic checks, seeded at `warn` with the note saying why.** Two of the
  three checks seeded there were actively wrong: `lint` ran `eslint --fix`, a check that
  rewrites the tree while judging it, and `test` blocked on a suite that opens a real database
  — red on every machine that has not started one.
  A blocking check that is red everywhere is a check people route around, and a routed check
  stops catching the real findings too. **The presence of a script is not evidence the suite
  passes.**

  **`memory/signals.jsonl` and `memory/decisions.md`, genuinely empty** — a format with no
  content. An empty file says "this is where what you earn goes". A seeded example says
  "you already earned this", and that is false.

  **Not the eight skills.** Under `--definitions-only` they are structurally unreachable, and
  a repo that already has its own calibrated ones gets two sources of truth with no way to tell
  which is inert. Not `patterns.md`, `retro-log.md` or `out-of-scope/README.md` either — they
  are containers for knowledge a new repo does not have, and reading them empty teaches the
  form without the reason, which is adr-0005's named trap.

  A blank a human fills beats a template's confident wrong answer, which is adr-0016's own
  accepted cost — and that run is the cost arriving.
- **Rejected: shipping the rules as always-on payload — and this one was RUN, not reasoned.**
  The mature workspace Whetstone generalises spent five weeks with a stitched `CLAUDE.md`: 807
  lines always in context, a 40-line base plus eight overlays. It reversed. Six weeks later it
  was 161 lines in three files injected by a session hook — **80% less** — with everything else
  loaded by trigger. The commit that made the big cut names its criterion, and the criterion is
  the transferable part: **conditionality, not importance.** What always applies stays injected;
  what sometimes applies is loaded when it applies. An emitter can apply that rule with no model
  at all, which is exactly the constraint here.

  So `init` writing eight skills into a target repo is Whetstone paying the cost of that peak
  without the benefit it at least had — nothing reaches them under `--definitions-only`.

- **Rejected: treating the origin payload as transferable.** Two measurements against that
  workspace, and together they are the concrete form of adr-0005's warning:

  Whetstone's `xreview` **was adopted from a skill the origin never accepted** — it lives there
  on an unmerged branch to this day. Whetstone has since amended its copy twice by retro, so it
  grew rules on top of something that repo never adopted.

  The origin's TDD skill requires implementation to land in commits SEPARATE from the test
  commit, written to stop an agent weakening tests to reach green. Whetstone's hard rule 4
  forbids exactly that: one commit per coherent change, with the red output quoted in the body.
  **Same concern, opposite mechanisms**, each earned in its own repo. A payload is not a thing
  you copy; it is a thing a project earns.

- **Rejected: keeping both paths — templates when there is no judge, the judge otherwise.** Two
  ways to produce one artifact, drifting, which is the defect class this repo has found six
  times. The minimum is deliberately NOT a smaller template: it is blanks.
- **Rejected: the judge writes the payload and `init` trusts it.** The engine keeps the
  manifest (what must exist), reference closure, the collision check, and the loaders — and
  refuses a draft that fails any of them. That refusal is the whole reason this is safe, and it
  is why it had to wait until `selfcontained` audited the copied files rather than skipping them.

Cost accepted: `init` gains a second mode, and the two produce different-quality payloads from
the same repo. Stated plainly rather than hidden behind a flag name.

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
`proposed` · 2026-08-21 · signals: sig-4a2610fb, sig-ea119c62

*Not in force. `init` asks its six questions and offers no opinion among them.*

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
`proposed` · 2026-08-21

*Half in force. A second adapter exists and `agent:` selects it; what does not exist
is a second `llm` check, so no two judges have yet reported on anything.*

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
