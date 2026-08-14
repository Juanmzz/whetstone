---
id: adr-0018
ts: 2026-08-14
status: proposed
supersedes: null
rules_affected: []
---
# A verification method is a third kind in the check registry, and it never blocks

## Context

Whetstone can say which discipline a change earns and what will judge it automatically.
It cannot say **how a change gets verified** when verification is not a command.

```
tier    → what discipline a change earns          .wst/triage.yaml     exists
checks  → what judges it automatically            .wst/checks/*.md     exists
method  → how you verify what a command cannot    —                    missing
```

The motivating case is a front-end change in a real product repo: drive a browser,
screenshot the three states, compare them against the intended design. Neither existing
`kind` expresses it. A `deterministic` check reduces to an exit code, and there is no exit
code for "the empty state looks wrong". An `agent-lens` reads a diff and returns a verdict;
it does not *do* anything, and a screenshot is not in a diff. This is an instruction an
agent **executes**, and its outcome is a report.

The charter (`core/dispatch/charter.ts`) has a `## What will gate your work` section and no
counterpart: a crewmate is told what will judge it, never how to test what it built. So it
invents that, differently every time.

The requirement that shapes the answer is the loop, not the feature. If a team learns
Playwright beats the Chrome MCP, that must be proposable by `wst retro` **with the signals
that earned it**, exactly as a skill amendment is. A method that cannot be amended from
evidence is documentation.

Three constraints bound the design. No workflow engine — adr-0011 rejected declaring steps
in YAML and executing them, and nothing has changed. Nothing may depend on the `correctness`
lens, uncalibrated at v4 for weeks. And a method naming a tool the target repo does not have
is sig-0041 repeated: a charter that names the wrong thing is worse than one that names
nothing, because it reads as authoritative.

### Alternatives weighed

- **A separate registry, `.wst/methods/`.** The obvious shape, and it duplicates the whole
  of the check file: `include`/`exclude` globs, `tiers`, `origin` receipts, `version`,
  `enabled`. Every consumer that asks "what applies to these paths" — `triage`, `plan`,
  `gate`, the charter — would then merge two registries answering the same question with two
  loaders that can disagree. Rejected: the selection machinery is the expensive part and it
  already exists.
- **A field on a triage rule.** Rejected on precision. Triage is first-match and coarse: one
  path gets exactly one rule, and rules are about *discipline*, not about surface. A change
  touching a component and its API client legitimately earns two methods; a triage rule can
  carry one.
- **Prose in a skill under `.wst/skills/`.** The cheapest option, and it is where this lives
  today by default. Rejected because a skill is not selected by changed paths — it cannot
  answer "which method applies to *this* diff", so neither `wst plan` nor the charter can
  name it at the moment it is needed, which is the entire complaint.
- **Make a method executable — let the gate drive the browser, or have the agent return a
  pass the gate consumes.** Rejected twice. The first half is the workflow engine adr-0011
  refused. The second is worse: a self-reported pass compiled into an exit code is a lie the
  gate would then carry, and an agent that can certify its own verification has no gate —
  the same sentence `charter.ts` already carries about merging and adr-0015 carries about
  approving a plan.
- **Do nothing; the human says how to test it in the task description.** Rejected: that is
  the status quo, and it is per-task, unversioned, uncited and unreviewable. It cannot be
  amended from evidence, which is the point of the whole thing.

## Decision

**A method is a third `kind` in the existing check registry.** `kind: "method"`, a file in
`.wst/checks/`, selected by the same `include`/`exclude`/`tiers` fields as everything else
there, carrying the same `origin:` receipts and the same `version:`. The registry stops
being "things that produce a verdict" and becomes "what verifies a change" — which is what
`wst check` was always answering.

**It is made of prose plus an optional named tool.** The procedure is prose an agent
follows. `tool:` declares a name and a `requires:` probe — how to tell whether the tool is
present — and **nothing else**: no arguments, no ordering, no steps. That line is where the
workflow engine would start, and it is the line. The prose is for the executor; the `tool:`
declaration exists so that `init`, `status` and `plan` can say "this repo does not have
that" instead of an agent discovering it mid-task.

**Whoever does the work executes it, during the work.** The result returns as the worker's
report and, when the method itself was wrong or missing, as a signal. There is no new
result channel and no new artifact.

**A method never blocks, and the schema enforces that at parse time.** `kind: "method"`
admits no `severity` above `annotate`, and refuses `command` and `review_lens` — the same
mechanism that makes non-negotiable 7 unforgettable rather than remembered. `wst gate`
reports the methods that applied as **declared, not verified**, and that report may never
share a message with a pass, per hard rule 3.

*Why unenforced is acceptable rather than a hole.* Enforcement here is deliberately one
deterministic decision (adr-0011), and a method's outcome is a human's judgment or an
agent's report. The two ways to force it into the gate are the two rejected above. What a
method buys is that the instruction becomes shared, versioned, path-selected and **earned**
instead of reinvented per task — and the gate naming which methods applied is what lets the
human gate that already exists (adr-0003) ask whether they were followed.

**The retro amends a method with the machinery it already has.** A method file is a `.wst/`
file with cited signals, so it is already inside the retro's blast radius and inside
`validateRecommendation`'s citation check. Chrome MCP → Playwright is an `amend`
recommendation targeting that file, citing the signals that earned it, bumping `version:`.
**No new `RecommendationKind`** — reusing `amend` is not a shortcut, it is the claim being
tested: that a verification method is the same kind of thing as a rule.

**Propagation follows adr-0016 and sig-0041: `init` never writes a method whose `requires:`
it did not resolve in the target repo.** It asks, or it omits. Declared facts, no inference
— a method assuming a tool the repo lacks is precisely the dangling authoritative pointer
that ADR is about.

**The tradeoff accepted:** the only new verification surface this project has added in
months is one the gate cannot enforce. We take that over an enforcement story that would be
either a lie or a second execution engine.

## Consequences

**Easier.** The front-end case becomes expressible at all. `wst plan`'s fourth output —
what nothing covers — splits into two honest categories: uncovered, and covered by a method
a person must run. The charter gains its missing half from the registry read it already
performs.

**Harder.** `.wst/checks/` now holds something the gate does not run, which strains the
vocabulary and gives hard rule 3 a new way to be violated: "only methods applied" must never
render as "checks passed". `wst check` has to mark methods as unenforced every time it lists
them.

**What it does not depend on.** Not the `correctness` calibration, not `MemoryPort`
(adr-0015), not any new port. It is a schema kind and a rendering.

**What reverses this.** If methods accumulate and no report ever cites one, the instruction
is being ignored, and the answer is to delete them — not to add a lens that judges whether
the method was followed. That is the argument adr-0009 applied to an annotation nobody read,
and it applies here first.
