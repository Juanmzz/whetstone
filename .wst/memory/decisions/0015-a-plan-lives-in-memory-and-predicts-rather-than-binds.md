---
id: adr-0015
ts: 2026-08-12
status: proposed
supersedes: null
rules_affected: []
---
# A plan lives behind the memory interface, and predicts rather than binds

## Context

ADR-0013 built the plan gate: `wst plan` reads a plan that declares the paths it
expects to touch and answers, deterministically, what will judge it. It filed one
consequence as a follow-up rather than deciding it — the **divergence report**, *"you
planned for `standard`, the diff earned `strict`"* — because that needs the plan to be
an artifact `wst gate` can find. Two questions were left open and they turn out to be
one question.

**Where does a plan live?** The request is that it live in the memory backend already
in use — engram — and not be committed to the repository. That collides with two
things already written down.

ADR-0001: *"The core must be fully functional with the file backend alone. Engram,
sqlite+FTS5, or any MCP memory server are optional adapters behind the same
contract"*, and *"we do not fork or hard-depend on engram."* `.wst/constitution.md`
carries the same sentence as a non-negotiable.

That is not a refusal. It says the plan goes behind the **interface**, not into a
specific product. But it exposes something bigger: **`MemoryPort` does not exist in
the code.** ADR-0001's three verbs — `save`, `search`, `summarize` — are declared and
unimplemented, and `.wst/memory/` is read today by direct file access. A plan stored
"in memory" is not a wiring job; it is the first real consumer of a port that was
never built, and it will drag that port into existence.

**Does a plan bind, or only predict?** This is where the storage decision stops being
a matter of taste. A plan that is not committed is **invisible to CI**. CI checks out
the repository; it has no access to a local engram, and it never will without shipping
credentials into the runner. So a contract check cannot run in the place where
enforcement actually happens.

And an absent plan must never read as a satisfied one. Hard rule 3: a check that could
not RUN is the gate being broken, not a verdict. "No plan was reachable" and "the
change matched its plan" cannot share a message.

### Alternatives weighed

- **Commit the plan as a file under `.wst/plans/`.** The simplest option and the ONLY
  one where a contract binds in CI: the plan travels with the change, so the runner
  can compare them. It also makes a signed plan evidence in the same sense an ADR is —
  the only record of what was agreed before code existed. Rejected against the stated
  preference, and recorded here in full because it is the option this decision would
  reverse to.
- **Store in engram directly.** Rejected outright: the constitution forbids a hard
  dependency on a specific backend, and this would put one on the critical path of a
  command.
- **Make the plan a blocking contract now.** Rejected. It cannot bind where
  enforcement runs, so it would block only on the machine that already knows the plan
  and pass silently everywhere else — a check whose strictness depends on who ran it,
  which is worse than no check.
- **Leave the plan on disk wherever the user points, no interface.** Rejected: that is
  a hard dependency wearing a config flag.

## Decision

**A plan is stored through ADR-0001's memory interface**, never at a fixed path. The
default backend stays files, so the core remains fully functional without engram;
engram is an adapter selected by configuration. Building `MemoryPort` is part of this
work, not a prerequisite someone else supplies.

**`MemoryPort`'s scope is bounded to what the plan actually needs**, and the bound is
part of this decision rather than an implementation detail, because the unbounded
version is a known trap. `src/core/ports.ts` today declares `GitPort`, `ClockPort` and
`LlmJudge` and nothing else; four adapters — `signals.ts`, `retro.ts`, `events.ts`,
`jsonl.ts` — reach `.wst/memory/` by direct filesystem access. ADR-0001 deferred the
port on purpose (*"M1 memory = files + grep"*), and it was right to: a port with no
consumer is the scope trap that same ADR names as this project's biggest.

So:

- **Declare all three verbs, implement two.** The plan needs `save` and `search`.
  `summarize` is the expensive one and has no caller. The file backend implements the
  two and `summarize` throws `not implemented` rather than returning something
  plausible — a port that lies about what it supports is worse than one that is
  visibly incomplete, and this repo has a rule about exactly that confusion.
- **Do not migrate the four existing adapters behind it.** They work, they are tested,
  and moving them is risk with no benefit until someone wants signals or retro
  artifacts in a non-file backend too. When that happens it is its own decision, with
  its own evidence.

The honest risk in even this bounded version: a port with a single consumer is the
same bet as `init`'s 2,529 lines written for a user who does not exist yet. What
separates them is that this consumer is present and running a backend today, rather
than hypothesised. If the plan-in-engram path goes unused, this port should be deleted
on the same argument the project applied to `wst pr`.

**Approval is a status flip in the plan's own frontmatter, and it is enforced.** A
plan is born `proposed`. A human moves it to `approved`. `wst prepare` REFUSES to
build a charter from a plan that is not `approved`, the same way an `agent-lens`
without a calibration receipt refuses to load. Writing the rule in a prompt would make
it advisory, which is the failure mode this project exists to replace. `charter.ts`
already carries the parallel sentence — *"a worker that can merge its own work has no
gate"* — and its twin is: **an agent that can approve its own plan has no plan gate.**

**A plan PREDICTS; it does not bind.** `wst gate` reports the divergence between the
planned tier and the earned one when the plan is reachable, and reports it as **not
checked** when it is not. It never blocks on it, and the two outcomes never share a
message.

**The tradeoff accepted:** the strongest version of this idea — a signed plan the gate
enforces, which is a thing no comparable tool does — is deferred. It is deferred
because of *where the plan lives*, not because of any doubt about the idea, and that
distinction is the whole content of this ADR.

## Consequences

**Easier.** Plans stop being repository clutter, and the memory port finally acquires
the consumer ADR-0001 assumed it would have. The plan gate becomes usable in a repo
whose owner does not want process artifacts in their tree — which is the same
constraint ADR-0012 records for the ChytaPay field work, so this is not a preference,
it is a pattern.

**Harder.** Two backends means a plan may simply be absent, and absence has to be
reported as absence at every consumer. That is one more place hard rule 3 can be
violated by someone taking a shortcut. And `MemoryPort` does not exist, so the true
cost of this decision is larger than it reads.

**What this blocks.** The divergence report can never block a merge while the plan is
unreachable from CI. Anyone who later wants a plan the gate enforces is proposing to
change where plans live, not to change this policy — and should say so.

**What reverses this.** If the divergence report proves useful locally, committing the
plan (or pushing it to a backend CI can read) turns prediction into contract with no
other change. That is the cheapest possible reversal and it is deliberate: this
decision is a storage decision wearing a policy hat, and the policy follows the
storage.
