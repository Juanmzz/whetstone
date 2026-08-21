# Independent review — what is the minimal Whetstone?

You are reviewing a real, working tool before its first public release. The
repository is private, so everything you need is in this document. Do not ask
for the code; reason from what is here and say plainly where the evidence runs
out.

Your job is **not** to summarise this document back. It is to answer one
question with a defensible cut list, and to argue against the obvious answer
before you settle on one.

---

## 1. What the tool is

Whetstone is a **self-sharpening standards layer for AI coding agents**. It
captures a project's definition of *correct* as plain files in git, enforces it
with a deterministic engine that calls an LLM only where judgment is
irreducible, and grows the checks a project needs from the friction it actually
hits.

The claimed differentiator is a closed loop:

```
use  →  record friction (signal)  →  distill (retro)  →  amend the rules  →  use
```

Comparable tools stop at the first arrow. The author's belief is that the loop
— not the gate — is the product.

Explicit anti-scope, from the project's own VISION: not a spec framework, not a
memory server, not autonomous self-modification, not a fleet manager.

## 2. Architecture, briefly

- `src/core/` — pure deterministic engine. Never imports `src/shell/`, never
  calls an LLM. Enforced by a test over the import graph.
- `src/shell/` — thin adapters: git, the `claude` CLI, worktrees, file I/O,
  the signal log, the event log, receipts.
- `.wst/` — the definition layer, source of truth, committed to git:
  `constitution.md`, `triage.yaml`, `checks/*.md`, `skills/*.md`,
  `memory/decisions.md`, `memory/signals.jsonl`, `memory/retro-log.md`.

Seven non-negotiables govern it. The four that constrain your answer:

1. **Files-first.** All state is plain text in git. The core must be fully
   functional with the file backend alone. No required servers or databases.
2. **Human-in-the-loop.** The retro proposes; a human disposes. No autonomous
   rule writes.
3. **Rules carry receipts.** Every rule — and every check — cites the signals
   or decisions that created it.
4. **Determinism by default.** The LLM is called only for irreducible
   judgment; `src/core/` never calls one.

## 3. The ten commands

| command | what it does |
|---|---|
| `wst init` | interviews a repo and generates its `.wst/` |
| `wst status` | repo, `.wst/` presence, judge health, version drift, whether the pre-push gate is armed |
| `wst check` | lists the check registry; refuses to load an uncalibrated blocking LLM check |
| `wst triage` | classify a diff → risk tier → which checks apply |
| `wst plan` | reads a plan file's declared `paths:` → predicted tier → which checks will judge it, and which declared paths **nothing** covers. Reads, never authors. No LLM. Never blocks. |
| `wst gate` | runs the checks, skips what receipts prove unchanged, passes or blocks, emits signals |
| `wst events` | reads the log `gate` writes: a run's timeline, which check took how long, how it ended |
| `wst prepare <task>` | leases a git worktree, branches it, writes a "charter" briefing built from the live check registry — then stops. Dispatches nothing. |
| `wst signal` | records an observation in `signals.jsonl`. Typed by the human; it IS the human gate |
| `wst retro` | clusters signals → proposes rule changes → never applies them |

## 4. Measured code cost

`src/` is **7,691 lines**, excluding tests and excluding comment-only lines.

"Exclusive" = lines in the import closure of that command and **no other**
command. It is what deleting the command would actually remove. "Shared" = the
rest of its closure, which survives as long as any other command needs it.

| command | own | exclusive | **total** | shared |
|---|---:|---:|---:|---:|
| `init` | 424 | 1701 | **2125** | 817 |
| `gate` | 358 | 150 | **508** | 2485 |
| `prepare` | 183 | 277 | **460** | 1037 |
| `retro` | 206 | 238 | **444** | 1513 |
| `events` | 188 | 186 | **374** | 2033 |
| `plan` | 65 | 235 | **300** | 1132 |
| `status` | 66 | 226 | **292** | 1282 |
| `signal` | 86 | 76 | **162** | 1303 |
| `triage` | 77 | **0** | **77** | 1037 |
| `check` | 45 | **0** | **45** | 1037 |

Read this carefully before concluding anything:

- `triage` and `check` have **zero** exclusive code. They are windows onto
  functions the gate calls anyway. Deleting them removes CLI wiring, not
  engine.
- `init` alone is **28%** of `src/`.
- `plan` + `prepare` + `events` together are **15%**.

## 5. Usage evidence, and its limits

The event log holds **194 runs and 1,165 events**. Every run is `wst gate`.

**This is a tautology, not evidence.** `emit()` is called from exactly one
file — the gate command. No other command can appear in that log. Treat any
argument of the form "nobody runs X, the log proves it" as unsupported.

What is actually known about usage:

- The gate runs on every push (a pre-push git hook) and in CI on every PR.
- `retro` has run four times, producing rule amendments to seven of eight
  skills, each carrying the signals that earned it.
- 54 signals recorded; 27 have a `resolved_by`. Six carry a machine `source`;
  the rest are hand-written by the human.
- There is **no telemetry at all** for `plan`, `prepare`, `triage`, `check`,
  `status` or `events`. Their usage is unknown, not zero.

## 6. Positions already taken, with their reasoning

You may overturn any of these, but you must engage the stated reason.

**`plan` is unproven, not over-engineered.** Of its 300 lines only ~131 are new
logic; the rest reuses the same `classify()` and `selectChecks()` the gate
calls. Its one unique value is answering *"which of the paths I intend to touch
does nothing cover?"* — before the code exists. A prior decision record
explicitly rejected making it author or refine the plan with an LLM, on the
grounds that this puts a model inside the engine for something that is not
irreducible judgment.

**`prepare` was cut down once already.** It used to dispatch an agent and gate
its work. A decision removed the dispatch half: it now leases a worktree,
writes a briefing, and stops. The removed sibling was ~2,881 lines.

**`events` is the only reader of `events.jsonl`.** Nothing else opens that file.
So the reader and the writer are one feature: cutting the command leaves the
gate writing a file nobody reads.

**An LLM check must earn the right to block.** The one LLM check in this repo
(`correctness`) is stuck at `warn` because its calibration measured too many
false positives. The schema refuses to load it as blocking without a passing
calibration receipt.

**Known weaknesses the author states openly:** mutation score 85% over a
40-mutation sample; most signals are hand-authored prose rather than
machine-observed; one decided-but-unbuilt feature has no owner.

## 7. A relevant outside data point

Robert C. Martin ships a comparable system (`unclebob/swarm-forge`): agents in
tmux, each in its own worktree, with roles for spec, code, cleanup, mutation
hardening and QA. Its "constitution" is ~140 lines of natural-language prompt
loaded into agent context, plus per-language tools for the CRAP metric
(cyclomatic complexity × coverage), DRY analysis and mutation testing.

Three of its rules match rules Whetstone arrived at independently — a
heartbeat so a long check is distinguishable from a hang; refusing to work in
the wrong worktree; keeping temp files out of the system temp dir. Whetstone
can name the incident behind each of its own; swarm-forge records no
provenance for any of them.

Whetstone has **no complexity metric and no coverage metric** of any kind.

---

## What to produce

**The question:** what is the smallest version of Whetstone that still delivers
the loop in §1, is honest about what it does, and is worth releasing publicly?

Answer in this shape, and nothing else:

1. **The cut list.** For each of the ten commands: KEEP, CUT, MERGE INTO ⟨x⟩,
   or DEFER. One sentence of reasoning each. Where you cut, say what capability
   is genuinely lost, not just how many lines are saved.

2. **The strongest case against your own list.** Write the best argument that
   your cut list is wrong, then say why you still hold it. If you cannot build
   a real counter-argument, your list is probably the lazy answer.

3. **What the measurement in §4 does *not* tell you**, and what you would need
   to measure instead to decide with confidence.

4. **One thing this project should ADD before release**, chosen for the loop's
   credibility rather than for feature count. Justify it against the
   non-negotiables in §2.

5. **The honest release risk.** What will the first serious outside reader
   attack first, and is that attack correct?

Constraints on your answer:

- Do not propose an orchestration or workflow engine. That was decided against
  twice, with the code deleted.
- Do not propose putting an LLM inside `src/core/`. Non-negotiable 4.
- Do not recommend keeping something merely because deleting it is cheap, nor
  cutting something merely because deleting it is cheap. Argue from the loop.
- Where you are guessing, write "guess" next to it.
