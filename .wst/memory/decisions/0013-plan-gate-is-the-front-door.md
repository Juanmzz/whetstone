---
id: adr-0013
ts: 2026-08-12
status: proposed
supersedes: null
rules_affected: []
---
# Build the plan gate as the front door, and let it answer "how will this be tested"

## Context

Three documents promise a plan gate and no code implements one.

- `VISION.md:79` puts it inside the boundary: *"Not a fleet manager. Whetstone takes
  **light** orchestration — triage, plan gate, fan-out, gate"*.
- `.wst/architecture.md:71` lists it as layer 3 and marks it **"NOT BUILT — declared,
  never implemented, no ADR either way"**.
- ADR-0008 repeats the same list when it draws the line between what Whetstone owns
  and what it delegates.

`README.md:33` goes further and describes it as shipped behaviour:

```
wst run    → triage → plan gate (critical changes only) → dispatch → gate → branch
```

That line describes a step that does not exist, which is the same class of false
self-claim `ace4222` was cleaning up two commits ago. This ADR closes the anomaly in
one direction or the other: either the plan gate gets built, or the three promises
come out of the documents.

**The original placement is disappearing.** The README puts it inside `wst run`, for
critical changes only. ADR-0011's second move removes `wst run`, so that home is
going away regardless of what is decided here.

**What the shape is actually for.** The working loop this is wanted for is: a task
arrives → the code, the constraints and the architecture get read → a solution is
proposed → a human iterates on it until "yes, do that" → **and at that point the
human wants to be told how it will be tested**, so that what comes back is already
self-verified and they know where to look. Then it is dispatched, and the human moves
on to planning the next one while it runs.

Mapped against the repo, every decision point in that loop is a Whetstone slot and
every execution step is somebody else's: the charter is built (`core/dispatch/`), the
gate runs at the back (`.githooks/pre-push` and CI, on the crewmate's own push), the
event log now says what is happening while it runs (ADR-0011, move 1). The one hole
is at the front, and it is the hole the human is standing in.

**What already exists to build on.** `classify(files, rules, rulesSource)` takes a
`ChangedFile[]` and nothing else. A plan that declares the paths it expects to touch
can be handed to the SAME function, unchanged, and get the same tier and the same
routing the gate would compute. There is no new classification logic to write, which
is most of why this is worth doing now: it is a new entry point onto machinery that
is already tested.

### Alternatives weighed

- **Keep the README's design: a step inside `wst run`, critical changes only.**
  Rejected twice over. Its host is being removed, and "critical changes only" inverts
  the value — the moment a plan is worth checking is *before* anyone knows how
  critical the change is. A gate that only fires once you already know the answer is
  decoration.
- **Have the engine WRITE the plan** — read the task, read the repo, propose the
  approach. Rejected, and this is the important rejection. It puts an LLM in the
  engine for something that is not irreducible judgment, contradicting the layer
  boundary the whole architecture rests on. Worse, it takes the one step the human
  explicitly wants to keep. Authoring the plan is a crewmate's job or a person's; the
  engine's job is to answer what will judge it.
- **Do nothing — the charter already lists the checks.** True, and it lists them at
  the wrong time: the charter is written at dispatch, after the approach is settled.
  The question being asked is "how will we test this" while the approach is still
  negotiable.
- **A workflow graph — declare the plan, the checks and the branches in YAML and
  execute it.** Rejected by ADR-0011 and nothing has changed: it reimplements state
  machines Temporal, LangGraph and GitHub Actions already own, and branching is
  exactly what would stop `aggregate.ts` being trustworthy.

## Decision

We will build `wst plan` as a standalone command — the front door, not a step inside
anything — and it will not be gated on criticality.

**It reads a plan; it does not write one.** The input is a plan that declares the
paths it expects to touch and what it intends to do. Whoever authored it — a person,
a crewmate, a conversation — is outside this boundary.

**It answers four questions, all deterministically:**

1. What tier does this earn, from `.wst/triage.yaml` and the declared paths.
2. Which checks will run, split into blocking and advisory.
3. Which of those a human still has to verify by hand — the paths that land in a
   strict tier with no check covering them.
4. What is *not* covered, stated as a gap rather than as silence.

**It does not block.** The name says gate and the gate is the human, in the same
sense `wst signal` is "for the human to type" (ADR-0003). The command emits; the
person decides. There is no exit code that stops anything.

**The tradeoff accepted:** a plan that declares its own paths can be wrong or
incomplete, so the tier it reports is a PREDICTION. We take that over the alternative
— inferring the paths with a model — because the ground truth already exists at the
other end: `wst gate` classifies the real diff, and a change that grew past its plan
gets its real tier there. The front door cannot be routed around, because it was
never the thing doing the enforcing.

**No implementation lands with this ADR.** The decision is the deliverable; ADR-0008
records what happens when code arrives before the decision it implements.

## Consequences

**Easier.** "How will this be tested" becomes answerable before the work starts,
which is the question that currently has no owner. The charter gets a better input:
generated from an approved plan rather than from a task string, it can name the
checks the plan was signed against. And the third output above — a strict path that
no check covers — is the informative half of what ADR-0009 deleted, arrived at from
the other direction: `wst pr` needed lens findings to say anything, and this needs
none, because "nothing verifies this file" is a fact about the registry.

**Harder.** Triage now runs in two places against two different inputs, and they can
disagree. That divergence has to be REPORTED — "you planned for `standard`, the diff
earned `strict`" — and never quietly resolved in favour of either. A predicted tier
that silently disagrees with the enforced one is worse than no prediction, for the
same reason a receipt that claims a pass that never happened is worse than no
receipt.

**What it does not depend on.** Nothing here waits for the `correctness` lens to be
calibrated, and nothing waits for ADR-0011's second move. It is independent of both,
which is why it can go first.

**Follow-up unlocked.** With a signed plan as an artifact, `wst gate` has something
to compare the real change against, and "this change did more than it said it would"
becomes a question the engine can ask. Not in scope here; noted so the shape of the
plan output does not foreclose it.

**What reverses this.** If the predicted tier diverges from the enforced one often
enough that nobody reads the prediction, the front door is guessing rather than
routing, and this should be deleted rather than tuned — the same reasoning ADR-0009
applied to an annotation that was almost always empty.
