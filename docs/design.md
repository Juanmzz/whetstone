# Design index

Where to read about each part, and the one format worth knowing before you edit
anything. `docs/architecture.md` is authoritative on what is true now; this page
only points.

## Start here, by question

| If you want to know | Read, in this order |
|---|---|
| What decides whether a change passes | `src/core/gate/run.ts` → `select.ts` → `outcomes.ts` → `aggregate.ts` → `report.ts` |
| How a change earns its tier | `src/core/triage/classify.ts` → `route.ts` → `rules.ts` |
| What `init` writes into a repo, and what stops it breaking one | `src/core/init/plan.ts` → `payload.ts` → `selfcontained.ts` → `collisions.ts` |
| Why any of it is shaped this way | `.wst/memory/decisions.md`, by anchor id |

## The documents

| | |
|---|---|
| `docs/architecture.md` | What is true now: the three parts, the loop, the stages, FCIS, the registry, the measured `claude -p` invocation |
| `docs/PARALLEL.md` + `docs/lanes.yaml` | Working in a lane, and who owns which slice |
| `.wst/constitution.md` | Governance and the non-negotiables |
| `.wst/triage-rules.md` | What each tier means for a human. `triage.yaml` is the source (adr-0022) |
| `.wst/memory/decisions.md` | Every decision by anchor id, carrying what it ruled out |
| `AGENTS.md` | Orientation and the hard rules. Thin on purpose |

## A check file, field by field

One markdown file per check in `.wst/checks/`. **The frontmatter is what the
engine parses; the body is prose for whoever has to fix a failure.**

```yaml
---
id: typecheck                    # must equal the filename stem
description: TypeScript compiles with no errors.
kind: deterministic              # deterministic | llm | method
severity: block                  # block | warn | annotate
tiers: [strict, light]           # which triage tiers it applies to
include: ["src/**/*.ts", "tsconfig.json"]
exclude: []
command: npm run typecheck       # deterministic only
agent: antigravity               # llm only; omit for the one wst.yaml selects
skippable: false                 # omit unless the answer depends on the range
slow: true                       # omit unless it is too slow to answer while someone waits
origin: [adr-0008]               # what earned this check
version: 2
---
```

Six fields carry more weight than they look:

**`agent`** names the judge for an `llm` check. Two judges report side by side as two
checks and never vote (adr-0026): AND multiplies false positives, OR lets a change find
the laxer judge, and a merged verdict has no single lens hash to bind a calibration to.
Omitted, a lens runs on whatever `wst.yaml` selects.

**`skippable: false`** refuses a receipt. A receipt proves a check passed on these file
CONTENTS, which is evidence only for a check whose answer is a function of them; one
that reads `WST_GATE_RANGE` answers a different question per range.

**`kind`** says who executes. `deterministic` runs a command and reads its exit
code. `llm` sends the diff to a model. `method` is prose an agent follows and
the gate runs nothing: it reports `declared` and can never block.

**`include`** is what invalidates the receipt. It must name everything the
command *reads*, not everything it is *about*: when it names less, a receipt
keeps matching after something that changes the answer has changed, and the gate
skips a check that would now fail. `test`'s include is nearly the whole
repository for exactly this reason.

**`version`** is part of the receipt's input hash. Change the check's behaviour,
bump it, and every receipt earned under the old behaviour stops matching.

**`origin`** is what earned the check: a decision, or the signals from real
friction. Non-negotiable 4: a check with nothing behind it is a guess. This is
the field that keeps the registry from filling with plausible ideas.

## How an `llm` check earns the right to block

It does not, by default. `severity: block` on an `llm` check **fails to parse**
unless `<id>.calibration.json` is present and its hashes still recompute. The
bar is 10 of 10 correct and unanimous across known-good and known-bad fixtures,
with zero flips.

The receipt binds to the fixture set, the lens text, the **model** and the
runtime, so editing the prompt or switching adapters invalidates the
authority rather than silently carrying it over.

`scripts/calibrate.ts` measures it. A failure is a result: this repo's own
`correctness` lens sits at `warn` because it invents a race in correct
concurrent code, and the run that proved it cost $4.45.

## Where state lives

| Path | What | Committed? |
|---|---|---|
| `.wst/checks/` | The registry, one file per check | yes |
| `.wst/skills/` | Rules that propagate to bootstrapped repos | yes |
| `.wst/memory/signals.jsonl` | Append-only observations, the retro's input | yes, `merge=union` |
| `.wst/memory/decisions.md` | Decisions by anchor id | yes |
| `.wst/memory/retro-log.md` | What each retro read and changed | yes |
| `.wst/receipts/` | Which check passed on which input | no, it is a cache |
