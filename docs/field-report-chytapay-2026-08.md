# Field report — installing Whetstone into ChytaPay (2026-08-10)

First install of Whetstone into a repo it did not grow up in: `agilpay-backend`, a
five-Lambda TypeScript payments API that already carries its own `CLAUDE.md` (412 lines),
its own plugin owning `.claude/`, husky hooks, and a CI guard on migrations. Exactly the
situation `--definitions-only` was written for — its doc comment names ChytaPay by name.

The install worked. `wst status` reports `ready`, and `wst gate` returned a real verdict
over a real diff (a money/PSP fix, 4 commits, strict tier). What follows is everything
that got in the way, with file and line, ordered by how much it would cost the next
person.

Findings are grouped by cause rather than by symptom, because the groups are the fix.

---

## A. `--definitions-only` is a second-class citizen in the dispatch path

`wst run` builds a charter that assumes the emitter ran. In `--definitions-only` it did
not, so the charter points a crewmate at two files that do not exist.

**`core/dispatch/charter.ts`** — the "Read before you write" block hardcodes:

- `AGENTS.md` — never written in this mode. Absent.
- `.sdd/architecture.md` — never written by `init` at all. It exists only in Whetstone's
  own repo, and the charter even describes its content ("FCIS: `core/` is pure and must
  never import from `shell/`"), which is a fact about Whetstone, not about the target.

**`commands/run.ts:66` and `:118`** — `strictPaths` is a literal:

```js
strictPaths: ["src/core/", ".sdd/skills/", ".claude/hooks/"]
```

Those are Whetstone's own strict paths. They are not read from `.sdd/triage.yaml`, which
is the file that exists precisely to answer this question. In `agilpay-backend` the strict
paths are `src/**`, `migrations/**`, `*.serverless.yml`, `cloudformation/**` and
`.github/workflows/**`; a crewmate dispatched there would be told that three directories
it will never touch are the dangerous ones, and told nothing about migrations.

The charter's own line — *"a gate you cannot see is a trap, not a standard"* — is the
argument for fixing this. A charter that names the wrong paths is worse than one that
names none, because it reads as authoritative.

**Suggested fix:** derive `strictPaths` from the loaded triage rules (they are already
loaded two lines earlier for `gatingChecks`), and make the "read before you write" list
conditional on what the target actually has. Under `--definitions-only`, `AGENTS.md` is
the wrong pointer; `CLAUDE.md`, or whatever the repo's own harness uses, is the right one
— which the mode cannot know, so it should ask at init time and record the answer.

## B. `init` emits text calibrated for the mode it did not run in

**Unreachable skills.** With `--definitions-only`, `init` still copies eight skills into
`.sdd/skills/`. Tracing their consumers: `core/init/plan.ts:101` (the emitter, which does
not run in this mode) and `commands/retro.ts:105` (which lists them for amendment).
Nothing else reads them, and nothing surfaces them to an agent. In this mode they are
structurally unreachable — not merely redundant with whatever the host harness provides,
but dead files that a reader will reasonably assume are live.

This matters more than it sounds, because a repo with a plugin already has its own
versions of most of them, usually calibrated to the domain. Here the plugin's
`chyta-tdd-discipline` carries integer-cents money rules and `chyta-xreview` carries a
data-boundary gate that keeps proprietary payment code away from third-party model
vendors. The generic copies say neither. Two sources of truth, one of them inert, and no
way for a reader to tell which is which.

**Suggested fix:** in `--definitions-only`, either skip the copy, or write them with a
header stating they are inert until something emits a config that references them.

**Generated text that is false.** The `light` row that `init` writes into both
`triage-rules.md` and `triage.yaml` reads:

> `{README,AGENTS,CLAUDE}.md` — Orientation prose. AGENTS.md and CLAUDE.md are generated
> from .sdd/ — edit the source and regenerate rather than patching them here.

Under `--definitions-only` that is false in both halves: nothing is generated, and there
is no `AGENTS.md`. It is also an instruction, and an agent will follow it — it will
decline to edit the host's hand-maintained `CLAUDE.md` and go looking for a source that
does not exist.

**Suggested fix:** the row is generated; generate the version that matches the mode.

## C. Seeded checks inherit the repo's scripts without inspecting them

`init` reads `package.json` and wires whatever it finds. Two of the three checks it
seeded here were wrong in ways that reading the script text would have caught.

**`lint` ran a mutating command.** The seeded command was `npm run lint`, which in this
repo is `eslint --fix './src/**/*.ts'`. A check that rewrites the tree while judging it
does not measure anything: it reports on a file that no longer exists in the form the
author wrote it, and it hides the finding it was meant to surface. The host's own
`CLAUDE.md` already warned about this in prose; `init` could not see the warning, but it
could see the `--fix`.

**Suggested fix:** detect `--fix`, `--write`, `-w` and similar in a seeded command.
Either strip the flag, or seed the check disabled with a note saying why.

**`test` blocked on a suite that is not hermetic.** Seeded at `severity: block` on the
evidence that a test script exists and test files are present. Large parts of this suite
open real connections to Postgres on `localhost:5432`; with the database down, 33 tests
fail for reasons unrelated to any diff. A blocking check that is red on every machine
without `npm run db:start` running is a check people learn to route around, and a routed
check stops catching the real findings too — which is the exact argument `init` already
makes, correctly, in the seeded `lint.md` for holding lint at `warn`.

**Suggested fix:** the presence of a test script is not evidence the suite passes.
Either run it once during `init` and seed the severity from the result, or seed brownfield
repos at `warn` with a note to promote after the first green gate.

## D. The plugin fails silent, and silence is indistinguishable from working

`plugin/hooks/gate-on-stop.mjs:31-33`:

> Every failure to RUN exits silently. No `.sdd/`, no `wst` on PATH, not a git repo: none
> of those are facts about the user.

The reasoning is right and the behaviour should stay. The cost is that there is no way to
discover it is happening. In this session the plugin was loaded and both hooks were inert
the entire time, for two different reasons, and nothing said so:

1. The orchestrating session's `CLAUDE_PROJECT_DIR` is `~/Documents/ChytaPay`, the
   umbrella folder that holds the repos. It is not a git repo and has no `.sdd/`.
2. The dispatched crewmate ran in a treehouse worktree, which *is* a git repo — but
   `.sdd/` was untracked at that point, and untracked files do not propagate to
   worktrees. So `gate-on-stop` never fired for the one agent it most existed to gate.

Point 2 deserves its own line, because it interacts badly with a posture people will
reasonably adopt: **an uncommitted `.sdd/` silently disables the plugin in every
worktree.** Someone trialling Whetstone before proposing it to their team — the obvious
way to trial it — gets none of the hook behaviour and no indication of that.

**Suggested fix:** `wst status` already knows all of this. Have it report the plugin as a
row alongside `.sdd/`, `judge` and `pre-push`: whether the hooks are installed, and
whether they would do anything from here. A "loaded, but inert in this directory because
X" line costs one paragraph and closes the whole gap.

---

## E. Process collision: two dispatch pipelines, no precedence

Not a Whetstone bug, but Whetstone is half of it, and it is the finding that actually
changed the outcome of the day.

The ChytaPay umbrella `CLAUDE.md` documents a four-step manual dispatch: `treehouse get
--lease` → `herdr tab create` → `wst gate --no-lens` → `treehouse return`. `wst run`
implements the same pipeline in one command, and better. Neither document mentions the
other, so the orchestrator followed the written one and hand-rolled what the tool already
does.

What the hand-rolled version lost, all of which `wst run` handles:

| Lost | `wst run` |
|---|---|
| The branch. Four commits sat on a detached HEAD with no ref; `treehouse return` would have orphaned them | `run.ts:99` — `git switch -C <branch>` |
| Several minutes on `npm ci` in the worktree | `run.ts:103` — symlinks the orchestrator's `node_modules`, with a comment crediting the first crewmate that hit it |
| The crewmate was never told what would gate it | The charter lists blocking and advisory checks by name, before work starts |

Worth noting in the other direction: `treehouse get --lease` cuts from `origin/main`,
while `run.ts:93` branches from the orchestrator's current `HEAD`. Both are defensible,
they are just different, and someone will be surprised once.

**Suggested fix, for Whetstone's side of it:** `wst status` in a repo whose harness
documents its own dispatch flow cannot know to say anything. But the README and the init
summary could state plainly that `wst run` is the supported dispatch path and what it
does, so a reader choosing between it and their existing process is choosing knowingly.

---

## F. ADR-0009 deleted the code and left the documentation

Checked whether Whetstone still carries a GitHub client. It does not, and the removal is
clean where it counts: `package.json` is `commander`, `yaml`, `zod` and nothing else;
`commands/pr.ts`, `core/annotate/` and `shell/github.ts` are all gone as of `afe1c8d`.
For the record, the deleted client shelled out to `gh api` through `execFile` — no HTTP
library was ever involved, so there is no `axios` or `octokit` anywhere in the tree.

But `.sdd/architecture.md` still contradicts itself:

| Line | Says |
|---|---|
| 22 | Lists "PR criticality annotation" as a live LLM responsibility |
| 27 | Table cell repeats "annotating the PR by criticality" |
| 71 | Correctly strikes it through, cites ADR-0009 ✓ |
| 127 | Roadmap still shows "4 annotated PR" as a stage ahead |

Three of four describe a subsystem that no longer exists, and one of them presents it as
still coming. This matters more than an ordinary stale doc because `architecture.md` is
one of exactly two files the crewmate charter orders **every dispatched agent** to read
(see §A). Every crewmate reads it, and gets a contradiction.

**Suggested fix, beyond the edit:** an ADR that deletes a subsystem should list the
documents describing it alongside the files implementing it. The front-matter has
`rules_affected` for rules; there is no equivalent for prose, and prose is what the
charter makes agents read. A `docs_affected` field, or a retro check that greps for the
removed subsystem's vocabulary, would have caught all four lines.

---

## What worked, and should not be lost in a list of complaints

- **`wst status` refused to hand over a footgun.** It detected that `.husky/_` already
  owned `core.hooksPath`, explained that git allows only one, and explicitly declined to
  print a command that would disarm something the user set up deliberately. Tools that
  decline to help you break yourself are rare.
- **The collision guard held.** `init` without `--force` aborted rather than overwrite a
  412-line `CLAUDE.md` with a one-line `@AGENTS.md`. The destructive path exists, is
  clearly marked, and lists what it will destroy before doing it.
- **`--definitions-only` wrote exactly what it promised.** Twelve files under `.sdd/`,
  nothing else. `CLAUDE.md` byte-identical afterwards, no `AGENTS.md` created.
- **The seeded `lint.md` prose argues for its own `warn` severity** — the reasoning about
  routed-around gates is the right reasoning, and is what made the `test` severity look
  wrong by comparison.
- **Triage classified the real diff correctly** as `strict` on the strength of two `src/`
  files out of four, and the gate's three checks ran and reported honestly.

---

## The verdict the gate produced

For the record, the thing all of the above was in service of:

```
triage  strict   (2 of 4 files under src/)

pass  lint        17847ms
pass  test        11000ms
pass  typecheck   17905ms

passed
```

The crewmate had self-reported "tsc clean, 153 suites green". The gate is what turned that
into something checkable. That is the product working, and it is worth saying after four
sections of what did not.
