---
id: adr-0011
ts: 2026-08-09
status: accepted
supersedes: null
rules_affected: []
---
# Build the event log; refuse the workflow engine; aim the project at measuring agents

## Context

An outside analysis proposed re-founding Whetstone as *"the deterministic execution
layer for AI software engineering"*: a YAML workflow engine with branching and `goto`,
a swappable `AgentRuntime`, structured `Evaluators`, a `MemoryProvider`, an event log,
and — as a consequence of those — the ability to run the same task through Claude,
Codex and Gemini and compare the results.

Crossed against the code, most of it already exists:

| Proposed | Present |
|---|---|
| `Evaluators` returning structured status | `core/checks/` + `CheckRunner` → `CheckOutcome` |
| Swappable `AgentRuntime` | `LlmJudge` port + `CrewmatePort`, `claude` adapter |
| `MemoryProvider` behind `save`/`search`/`summarize` | ADR-0001, the same three verbs |
| "the LLM proposes, the engine verifies" | `core/gate/aggregate.ts` |

An analysis written without reading the repo converged on the repo's own shape. That is
the strongest architectural validation available, and it means the proposal's value is
concentrated in the two parts that do NOT exist.

The analysis also carried one claim that is false and one that is true.

**False:** that `VISION.md` describes something smaller than the code, quoting *"it
owns the feedback loop, not the forward workflow"*. That sentence was retired on
2026-08-07; `VISION.md` carries the amendment note and ADR-0008 is the reason. The
live boundary is *"not a fleet manager"*, which explicitly grants *light orchestration
— triage, plan gate, fan-out, gate*. There is no doc/code divergence.

**True, and the most useful sentence in the analysis:** *enforcement is solved,
execution state is not.* `wst run` dispatches a crewmate with a 30-minute timeout and
emits nothing for its duration — no current step, no progress, no resume, and a crash
loses everything. Every request for "let me see what the agents are doing" that this
project has fielded is a request for that missing model. The TUI asked for earlier was
not decoration; it was the surface of a model that does not exist.

### Alternatives weighed

- **Build the YAML workflow engine** (`if: tests.failed → goto: fix`). Rejected on
  three grounds, the last decisive. It reimplements state machines that Temporal,
  LangGraph, Dagger and GitHub Actions already own. It contradicts the one thing here
  that works: `aggregate.ts` is trustworthy *because* it is 88 lines of fold with no
  I/O, no ports and no configuration, and branching turns it into something else. And
  it adds thousands of lines to a project that removed 2,881 the same day for being
  more than its author could hold.
- **Refactor to `core/ | agents/ | evaluators/ | memory/ | git/ | cli/`.** Rejected:
  that separation exists (`core/` pure, `shell/` adapters, ports as parameters), and a
  dependency audit the same day showed every subsystem is a leaf, individually
  removable. Renaming directories costs a day and buys nothing.
- **Keep `wst run` and grow it into the orchestrator.** Rejected: worktree dispatch is
  commoditised (Vibe Kanban, container-use, Conductor, firstmate) and Claude Code now
  ships native worktree support. "Isolated parallel agents" has an expiry date and
  cannot be the differentiator.
- **Do nothing and go straight to distribution.** Rejected, but nearly right — see
  ADR-0010. Distribution is still sequenced after the gate proves itself.

## Decision

Three moves, in order.

**1. Build an append-only event log.** One primitive that pays three debts already on
the books: observability (what is a dispatched agent doing right now), resumability (an
event log *is* a checkpoint), and comparison (two agents on one task cannot be compared
without a common record). Git-native and plain text, like every other piece of state
here.

**2. Remove `wst run`** once the log exists, and delegate dispatch to whatever the user
already runs. Whetstone supplies the gate that decides whether the result is
acceptable — a *merge authority*, which is a slot firstmate and similar harnesses
already have.

**3. Aim at measuring agents, not running them.** The one differentiator an outside
survey could not find elsewhere was calibration: an LLM check earning its blocking
power by measured precision, enforced by the schema. Running the same task through
different agents against the same evaluators and reporting what actually passed is that
idea generalised. `scripts/calibrate.ts`, `CheckOutcome` and receipts are already most
of the machinery.

We will NOT build a workflow engine. The gate stays one deterministic decision.

The tradeoff accepted: Whetstone gives up being the thing that *runs* your agents,
which is the visible, demo-able half, and keeps the half nobody else is doing. It will
look smaller than the tools it sits next to.

## Consequences

**Easier.** "What is it?" gets a one-sentence answer that does not overlap a crowded
market: it gates AI-written changes, and it tells you which agent actually works on
your repo. Every deletion so far (`wst pr`, next `wst run`) points the same way.

**Harder.** Nothing here demos well. A gate and a log are invisible when they work, and
the tools this now composes with are the ones with the screenshots.

**Follow-ups unlocked.** The log makes a TUI possible without Whetstone owning one:
anything can tail it. It also makes `wst run`'s removal safe, because the information
that command produced by blocking is then available by reading.

**What reverses this.** If the event log lands and the gate still has no user beyond
this repo after a real trial, the problem is not the surface area and no further
subtraction will fix it — that is the point to question the premise, not the shape.
