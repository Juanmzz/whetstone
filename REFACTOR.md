# Refactor notes

A working document, not a plan anyone is executing yet. It accumulates what a
file-by-file read of the code turned up, with the argument for and against each
item, so the decisions get made deliberately instead of in the moment.

**The bar this is measured against:** Whetstone should be *good enough to prove
that building with AI improves when you use it* — and no bigger. Not a monster.
Every item below is judged by whether fixing it moves that bar or just moves
code around.

Status legend: **open** — argued, not decided · **agreed** — decided, unbuilt ·
**done** — landed, with the commit.

---

## 1. The vendor choice is hardcoded in five places

**agreed** · the shape below is decided; Gemini itself comes later

`architecture.md` says *"Agnosticism is multiple adapters behind [one port];
`agent:` config selects one."* **That is false twice over:** there is no
selection code, and there is no `agent:` key anywhere to configure. The claim
describes something nobody built.

`createClaudeJudge()` is called directly at five composition roots:
`commands/init.ts:406,430`, `commands/retro.ts:162`, `commands/status.ts:73`,
`commands/gate.ts:427`. A second adapter today means editing five files.

**Not a naming problem.** `LlmJudge` (`core/ports.ts:78`) is already the generic
port, and `createClaudeJudge` correctly names the Claude adapter's factory — a
Gemini one would be `createGeminiJudge`. Renaming it to `createLLMJudge` would
misdescribe what it builds.

**The shape:** one `resolveJudge(config)` returning an `LlmJudge`, reading an
`agent:` key from `.wst/wst.yaml`. Five call sites become one, the doc becomes
true, and Claude stays the only adapter until a second one is measured.

**This also gives `wst.yaml` a reason to exist.** It already declares
`backend: files  # files | engram | ...` — an extension point for the memory
port — and **nothing reads the file at all** (see #10). Both pluggability
decisions belong in it, and wiring one is what makes the file live rather than
decorative.

**Then, in order:** a Gemini adapter, so the two can be run over the same
calibration fixtures. That comparison is the only measurement that can detect
self-preference bias — a judge grading code written by its own family — which is
the one judge bias this design does not rule out by construction. A written
handbook for adding a third (codex) comes after, not a third adapter.

---

## 2. The pre-push hook takes over the whole hooks directory

**partly done** · the detection half already exists (see below); the design choice is still open

Activation is `git config core.hooksPath .githooks`. That setting is
repo-global: it redirects **every** git hook, not just `pre-push`. A project
already using husky or lefthook has its hooks silently disabled by it.

This is known — `plugin/skills/init/SKILL.md:22` tells an agent *"a `.husky/`
directory means husky owns `core.hooksPath`. **Never** tell them to run `git
config core.hooksPath .githooks`; that disables it. Chain instead."* And
`wst status` reports the configured path verbatim rather than as a boolean,
specifically so a husky repo is not told to disarm itself.

**So the hazard is handled by prose an agent must read and obey, not by code.**
That is thin for a failure whose blast radius is "every other hook this project
had stops running".

**Already built, verified 2026-08-19:** `core/status/report.ts:141` detects that another
tool owns `core.hooksPath` and **refuses to print a command that would disarm it** — *"there
is one core.hooksPath, so any instruction we could give here silently disarms whatever is
already protecting this repo, and choosing that for someone is not status's call."* So the
detection half is done; what remains is a design choice.

**Remaining options:** always chain rather than own ·
always chain rather than own · ship a `wst-gate` script the project's own hook
calls, so Whetstone never owns the directory. The third is the smallest promise.

---

## 3. `paths.ts` carries a rename that is over

**done**

`LEGACY_DEFINITION_DIR` and `legacyDirectoryMessage()` exist for a rename
(adr-0012) that has already happened. Every `wst status` pays a filesystem check
for the old directory (`commands/status.ts:87`) that can only ever miss.

*(Written without the old name spelled out on purpose: `test/definition-dir.test.ts`
scans every root file for it, and this document was the first new root file since
that check was written — it caught this on its first opportunity, which is the
design its own comment argues for.)*

Worse, the message it produces says **"(ADR-0012)"** to a user. Internal
decision ids should not reach anyone outside this repo.

**Keep** `DEFINITION_DIR`: `.wst` appears in ~225 places, and ~216 of them are
*sentences* that `init` writes into a target repo, not paths. Removing the
constant means hardcoding again in 225 sites.

**Cut** the legacy half and the ADR leak.

---

## 4. `.wst/` mixes three different kinds of thing

**done** · `architecture.md` and `lanes.yaml` moved to `docs/`

`.wst/` is described as the definition layer — what `init` writes into a target
repo. Its contents do not all fit that description:

| | Travels to a target repo? |
|---|---|
| `constitution.md`, `triage-rules.md`, `triage.yaml`, `checks/`, `skills/`, `memory/`, `wst.yaml` | yes |
| `architecture.md`, `lanes.yaml` | **no — `init` never writes them** |
| `events.jsonl`, `receipts/` | runtime state, gitignored |

`architecture.md` describes Whetstone's own internals — FCIS, the measured
`claude` invocation, the check registry. No repo that installs Whetstone needs
any of it. `docs/` already holds exactly this kind of document (`PARALLEL.md`).

**Move both to `docs/`.** Cost: references in `constitution.md`, `AGENTS.md`,
`README.md`, `decisions.md`, `charter.ts`, `ports.ts`, `claude.ts`,
`PARALLEL.md`. Mechanical.

Related: `ORIENTATION_DOCS` (`core/dispatch/charter.ts:43`) lists
`docs/architecture.md` as a doc to orient a crewmate. It is filtered by what
actually exists, so it does not dangle — but it is the one entry of five that
can only ever match inside Whetstone's own repo.

---

## 5. Comments are 37% of the core

**agreed**

Measured on `src/core/`: **3,093 comment lines against 5,180 of code.** Files
routinely open with 20-line headers narrating history, rejected alternatives and
past incidents.

The rule this project should hold itself to, and ship: **comments are brief and
confined to what the code cannot express.** The code must read clearly as
written — naming and structure carry the meaning. History and rejected
alternatives belong in `.wst/memory/decisions.md`, which exists for exactly that.

This is also a candidate for a shipped skill, so every bootstrapped repo gets it.
That path is a signal → retro → amendment, which is the human's to start.

---

## 6. `exists()` exists four times

**done** · one `shell/fs.ts`

`shell/sdd.ts:29`, `commands/init.ts:305`, `commands/status.ts:22`,
`commands/signal.ts:58`. Four copies of the same four lines. `signal.ts` writes
it as a promise chain, the others as try/catch.

No rule is encoded in it, so the drift cost is near zero — but it is four
copies, and this repo has found the same defect class seven times.

---

## 7. Git is right for one job and questionable for the other

**done** · hashing moved in process; 391ms → 34ms over 50 files

**Defining what changed:** `git diff --name-status A..B`. Irreplaceable, and
nobody has to invent a definition. Keep.

**Hashing content:** `git hash-object`, one process spawn per changed file.
Measured over 50 files:

```
git hash-object (1 spawn each):   391 ms
readFile + sha1 in-process:        30 ms
→ 13x
```

Git's hash buys nothing here — the receipt never compares against git's object
store, it just needs a content fingerprint. Any hash would do.

**Against changing it:** for a typical 5-10 file change the absolute difference
is ~40ms vs ~5ms. Not worth touching the receipt path for speed alone.
**For:** it removes a spawn-per-file and a dependency on git being on PATH for
something git is not needed for.

---

## 8. Naming, gate pipeline

**open**

Found while reading `core/gate/` end to end.

| Today | Problem | Candidate |
|---|---|---|
| `RunOutcome` | Not the outcome of a *run* — of one check. Three types end in `Outcome` at three levels (`CheckOutcome`, `RunOutcome`, `GateOutcome`) | `CheckRun` |
| `ports.run` | Run *what* | `runCheck` |
| `Prepared` | Bare adjective; it is a check bundled with its hashed input | `CheckWithInput` |
| `hashed` / `hash` | Two fields, two letters apart, different things: the per-file list vs the combined input hash | `hashedFiles` / `inputHash` |
| `unknown` (Selection) | Unknown what — ids routing named that the registry lacks | `missingFromRegistry` |
| `hashes` (the Map) | Holds *promises*, not hashes | `pendingHashes` |

Also: four of `Selection`'s five buckets mean "did not run", for four different
reasons, and the names do not distinguish them without reading the doc comment.

---

## 9. Two different things are called "layers"

**done** · the page says which it means

`architecture.md` describes **6 conceptual layers** (definition, init, triage,
execution seam, gate, self-sharpening) — about the product.

The code has **7 dependency layers** — about imports. They do not line up.

Sharing the word costs a reader their bearings before they open a file.

---

## 10. Small, confirmed

**open**

- `core/init/triage.ts:5` says the rules render **three** ways and names
  `.claude/hooks/strict-path-guard.mjs`. That file does not exist;
  `.wst/triage-rules.md:27` repeats the claim.
- `.wst/wst.yaml` is written by `init` and read by nothing — and it is worse
  than inert. Its `backend: files  # files | engram | ...` selects among
  implementations of a **port that does not exist**: `grep -rn MemoryPort src/`
  returns nothing, and adr-0015 says so in as many words (*"MemoryPort does not
  exist yet. Not in force."*). Its comment points at `.wst/memory/README.md`,
  which `init` writes into target repos but which is **absent from Whetstone's
  own `.wst/memory/`**. And that comment is itself stale: `renderWstYaml`
  produces `# files = self-contained, git-native, zero deps` today, so this
  repo's own `wst.yaml` predates its own generator. **The tool does not eat its
  current output.** Worth a check: regenerate the payload and diff it against
  what is on disk.
- `core/init/checks.ts` embeds the `correctness` lens prompt, two versions
  behind `.wst/checks/correctness.md`, pinned by nothing.
- `core/graph/edges.ts` re-implements the signal parser while importing the
  decision parser one line above.
- `core/init/payload.ts` has two mechanisms for one job: the 8 skills are
  **copied** from real files, everything else is **embedded** as TypeScript
  template literals. The second costs escaping, no syntax highlighting, and was
  the reason a function once assembled `"im" + "port"` to evade the architecture
  test.
- Orphan receipts on disk for checks that no longer exist (`adr-shape`,
  `red-first`, `untested`). Harmless — gitignored, never read — but nothing
  cleans them.
- 4 of 10 hard rules are enforced by nothing (TDD/RED-first, grounding API
  claims, isolating a negative control, and — with the lane guard now pinned —
  they are honour rules by design, worth stating rather than discovering).

---

## Deliberately not on this list

Things a read might flag that are correct as they stand:

- **`createDistrustfulReceiptStore`** was reported dead by a review agent. It is
  not — `--no-receipts` calls it at `commands/gate.ts:417`. Only its docstring
  is stale.
- **`.githooks/pre-push` does not swallow exit 2.** It prints a different
  message and still exits 1. Only `plugin/hooks/gate-on-stop.mjs:54` exits 0 on
  it, which is arguably right for a Stop hook and wrong only in saying nothing.
- **`--json` prints to stdout** via `console.log`, which is exactly how a
  subprocess reads it. 9 of 10 commands carry the flag; `signal` is the
  exception, and it is the one a human types.

---

## 11. Vendor knowledge leaks into a generic command

**done** · `pluginHookRoot()` in the plugin adapter

`commands/status.ts:81` reads `process.env["CLAUDE_PROJECT_DIR"]` inline.

`shell/plugin.ts` already exists and is exactly the right home: it is the
harness-plugin adapter, it spawns `claude plugin list --json`, and its header
says it is thin on purpose. Vendor knowledge belongs in an adapter.

Moving it there — as e.g. `pluginHookRoot()` — leaves `commands/status.ts` with
zero vendor-specific code.

Verified while reading: `src/core/` is already clean of `CLAUDE_*`. The only
`.claude` strings in the core are path literals in `init/`, which are about
writing the vendor directory ADR-0002 requires, not about reading its
environment. So this is one call site, not a pattern.

---

## 12. Build the memory port

**agreed** · wanted, so the tool is fit to grow

Non-negotiable 2 says memory is an interface — `save` / `search` / `summarize` —
and that nothing may hard-depend on a backend, engram included. Today
**`MemoryPort` does not exist** and `wst.yaml` has a `backend:` key selecting
among implementations of it (see #10).

Order that keeps it honest:

1. The port, plus a `files` adapter that wraps what `.wst/memory/` already does.
   `backend:` starts meaning something.
2. Wire `resolveJudge` the same way (#1), so both extension points read from one
   config file and `wst.yaml` stops being decorative.
3. An engram adapter only once there is a consumer files genuinely cannot serve.
   The candidate is **cross-project recall** — *"has any repo I own hit this
   before?"* — because signals are per-repo and a shared daemon is not. That is
   additive; it does not compete with git.

adr-0015 names the trap this must avoid: *"a port with no consumer is this
project's named scope trap: declare three verbs, implement two, and let
`summarize` throw."* So step 1 ships with a real consumer or not at all.

Constraint that does not move: non-negotiable 1 is *"the file backend alone. No
required servers or databases."* engram is always optional; files stay the
default and the only thing a fresh repo needs.

### Considered: copy engram's storage, or depend on it directly

[engram](https://github.com/Gentleman-Programming/engram) is a Go binary over
**SQLite + FTS5**, exposed by CLI, MCP and HTTP. Two proposals were weighed.

**Reimplement SQLite + FTS5 here — rejected.** In Node that means
`better-sqlite3` (native compilation, breaks across Node versions) or
`node:sqlite` (experimental, and FTS5 depends on how the build was configured),
and it makes this project the owner of a database. Measured against 9,990
simulated signals (11 MB of JSONL):

```
parse every line   266 ms
regex search        16 ms   (1,850 hits)
```

The problem FTS5 solves does not exist at this scale, or at ten times it.

**Depend on engram directly — forbidden by name.** Non-negotiable 2: *"Never
fork or hard-depend on a specific backend (engram included)."* As an optional
adapter it is exactly what that rule describes; as a dependency it is vetoed.

**The deeper reason engram cannot be the home for signals:** they are not agent
memory. They are a structured log, versioned in git, and **reviewed in a pull
request** — the human gate is that you see them in a diff. Move them into a
database and that property is gone. An engram adapter would be an *index over*
the log, never its owner.

**What engram does validate:** its MCP surface is `mem_save` / `mem_search`,
which maps almost directly onto adr-0015's `save` / `search` / `summarize`. The
port shape is not being invented in a vacuum.

---

## 13. Config that is written and never read

**agreed** · a rule, not a one-off fix

`backend:` in `wst.yaml` is written by `init` and parsed by nothing. So is the
whole file. A key that looks like configuration and configures nothing is worse
than its absence, because a reader reasonably changes it and expects an effect.

**The rule:** anything `init` writes as configuration must have a reader, or it
does not get written. Candidate for a check: parse every key the payload emits
and fail when nothing in `src/` reads it.

Related and cheap: **regenerate the payload and diff it against this repo's own
`.wst/`.** Whetstone self-hosts, so the two should be identical; they are not
(see #10). That drift is the exact class this project claims to catch.

---

## 14. Naming: `agent-lens` hides the distinction that matters

**open**

`KINDS = ["deterministic", "agent-lens", "method"]`. Two of the three begin with
"agent", and the real difference is *who executes*:

| Today | What it actually is | Candidate |
|---|---|---|
| `deterministic` | we run a command, the exit code decides | unchanged |
| `agent-lens` | **we** call a model | `llm` |
| `method` | prose **someone else** follows; we run nothing | `method` / `manual` |

`llm` is honest about the mechanism and separates it from `method` at a glance.
Cost: it is in the schema, every check file's frontmatter, the seeded payload,
and the docs.

---

## 15. Documentation shape

**agreed**

- **`docs/design.md`** — an index that points at the documents worth reading in
  depth, so `README.md` does not have to carry everything. First entry: the
  anatomy of a check file (frontmatter is what the engine parses; body is prose
  for whoever has to fix it; `version` is part of the receipt hash; `origin` is
  what earned the check).
- **`README.md` gets shorter.** It is the first thing a stranger reads and today
  it explains too much.
- `docs/` also becomes the home for `architecture.md` and `lanes.yaml` (#4).

---

## 16. Revalidate the checks themselves

**open**

Seven checks run on this repo. Four of them — `adr-refs`, `docs-fresh`,
`provenance`, `skill-shape` — are Whetstone-only: `init` never seeds them, and
they would mean nothing in a payments API. They exist because this project's own
documentation discipline needed enforcing.

That is the loop working, and it is also worth re-examining: each of the four
costs a run on every push. Ask of each — what did it last catch, and would its
absence be noticed?

Open specifically:

- **`adr-refs`** verifies that decision ids cited anywhere still resolve. Its
  value depends entirely on the citation rule staying (see the debate below).
- **`docs-fresh`** pins counts in `AGENTS.md`'s status block. It has blocked
  real pushes and produced the repo's first machine-written signal, so it earns
  its place — but a status block that needs a check to stay true is a status
  block doing too much.

### The ADR debate, recorded

Challenge: `.wst/` lives in git, git keeps history, so why an append-only
decision record with stable ids rather than one document that mutates?

What git cannot supply: **a rejected alternative never enters a diff.** You
cannot `git log` a road not taken. But that argues for recording rejections, not
for stable ids.

**The ids are load-bearing for one reason: checks cite them.** `origin:
[adr-0008]` on `typecheck`; non-negotiable 4 requires a check to name what
earned it. That rule is what stopped an unearned check from being registered in
PR #61 — no signal in the log had asked for it. Without stable ids `origin:`
points at nothing and the rule loses its teeth. `check-adr-refs` verifies those
citations still resolve.

**The resolution to "this contradicts fluid evolution":** the citation does not
have to be an ADR. `test` carries `origin: [adr-0008, sig-0005, sig-0006]`.
Signals are the lightweight citation, and the fluid path already exists —
friction → signal → retro → a new check citing signals. ADRs are only for
decisions that ruled something out.

Position: **ids are structural, volume is negotiable.** 22 ADRs is heavy for a
tool this size, and adr-0019 already compacted them once.

---

## 18. `triage-rules.md` is declared the source and nobody reads it

**done** · adr-0022 supersedes adr-0005; the table matches the YAML now

adr-0005 makes the markdown table in `.wst/triage-rules.md` the source and
`.wst/triage.yaml` its compilation. In practice `shell/sdd.ts:126` opens the
YAML and **nothing parses the markdown at all**. They have already drifted: the
table omits `src/commands/**`, `src/cli.ts` and `docs/**`, all of which are in
the YAML.

The current state is the worst of both — a decision names a source, nothing
enforces it, and the two disagree.

1. **Make the compiler real.** Markdown is the source, YAML is generated, a
   check verifies they agree.
2. **Demote the markdown to documentation** and amend adr-0005. The YAML is what
   the engine reads; the table is a human rendering, generated *from* the YAML
   or dropped.

**Take option 2.** Option 1 adds a compiler and a check to keep in sync a table
nobody reads, while the pair that actually matters —
`DEFAULT_RULES_YAML` ↔ `triage.yaml` — is already pinned byte-for-byte by
`test/triage-defaults.test.ts`. Same principle as `backend:` (#13): if nothing
reads it, do not pretend it configures anything.

---

## 19. `wst plan` is the least-justified command, and its name misleads

**open**

**The name.** `plan` reads as *"make a plan"*. It does the opposite: it reads a
plan a human already wrote and reports what will judge it. adr-0013 is explicit
— *"Reads, never authors; no LLM; never blocks."* `wst preview` or `wst forecast`
would say what it does. Cost of renaming: the command, the docs, the skills.

**The justification.** The event log holds **174 runs, every one of them
`gate`**. There is no evidence anyone has run `plan` in anger — not in this repo
and not in sift.

What it gives over `wst triage` is that it works *before the code exists*: you
declare the paths you intend to touch and learn what will judge them, and what
**nothing** will cover. That last half is the real argument — "nothing covers
these paths" is worth knowing before investing, because the answer may be "add a
check first".

**It is cheaper than it looks.** Of its 375 loc the genuinely new logic is
`preview.ts` at **131 lines**; `parse.ts` is reading a file and `report.ts` is
printing. It reuses `classify()` and `selectChecks()` — the same functions the
gate calls, not copies of them. It is a thin front door over machinery that
already exists.

**So the verdict is not "over-engineered" but "unproven".** Cheap to keep, and
nobody has tested whether it earns attention. Decide by using it for a week, not
by arguing.

### The narrower version, and how to test it without building it

The ask, stated precisely, is **not** "the engine writes the plan". It is
*"Whetstone helps refine the plan I am writing, using the LLM."* The pen stays
with the human; the model advises. That is a smaller claim than the one
adr-0013 rejected.

It also has an angle no general coding agent has: **Whetstone knows what will
judge you.** "Refine this plan" with the check registry and the triage rules in
context is a different question from asking a model to help you plan.

**Test it outside the engine first.** `wst plan --json` already emits the
prediction as data. A skill that tells an agent *"run `wst plan --json`, look at
which declared paths nothing covers, and propose what is missing"* exercises the
whole idea **without putting an LLM inside the engine** — which is exactly what
adr-0013 set out to prevent. If it proves useful, reopen adr-0013 with evidence.
If not, nothing was spent.

### Recorded: the ask to make `plan` author the plan

Raised, and it is what adr-0013 rejected as the load-bearing point: *"having the
engine WRITE the plan. That puts an LLM in the engine for something that is not
irreducible judgment, and it takes the one step the human explicitly wants to
keep."* adr-0011 guards the same border from the other side — a tool that writes
the plan, dispatches the agent and gates the result is the workflow engine that
decision refused, *"thousands of lines … in a project that removed 2,881 the
same day for being more than one person could hold."*

The counter worth weighing: refining a task is not a workflow graph. If this is
reopened it goes through a status flip on adr-0013, not a quiet rewrite.

---

## 25. `wst retro` is broken in four ways, and one of them is silent and expensive

**agreed** · reported from sift, reproduced twice there, all four confirmed in
this source. Ranked by cost.

### 25a. The cursor regex only matches the OLD id format

`shell/retro.ts:39` reads the cursor with:

```js
/^cursor:\s*(sig-\d+)\s*$/gm
```

`\d+` is digits only. Signal ids moved to hex — sift's are `sig-0828a42b`,
`sig-4e91c07b`; this repo's newer ones are `sig-82dec46b`, `sig-cb978aef`. None
of them match, so `readCursor` returns null and **every retro reprocesses the
entire log from the beginning.**

It is broken here too, not only in sift. `.wst/memory/retro-log.md`:

```
line   8:  cursor: sig-0016
line  55:  cursor: sig-0025
line 101:  cursor: sig-cb978aef · 24 signals · 9 clusters, 7 actionable · $0.7283
```

Line 101 is the newest and fails on **both** counts — hex id, and trailing text
after it, which `\s*$` also rejects. So `.pop()` falls back to line 55, two
retros stale. The run on 2026-08-19 reported *"29 since sig-0025"* and spent
$0.78 re-proposing over signals an earlier retro had already handled; the
proposals cite `sig-0027`–`sig-0041`, all old.

Fix: widen the character class to the real id shape and stop anchoring at
end-of-line. Better: have the retro write the cursor in a form it parses back,
and test that round-trip.

### 25b. `proposing...` prints once, then up to an hour of silence

`commands/retro.ts:167` prints it **before** the loop at `:168`. Inside, one
`judge.judge()` per actionable cluster, sequential, `maxAttempts: 3`
(`retro.ts:174`), against `DEFAULT_TIMEOUT_MS = 120_000` (`shell/claude.ts:28`).

Worst case: **10 clusters × 3 attempts × 120s = 60 minutes with no output.**

It is not hung; it is grinding without saying so, and after a few minutes that
is indistinguishable from a hang — so it gets killed. That is the reported
symptom "clustered fine but left no proposals". Same defect as #20, one command
over: announce the start and go quiet.

Fix: one line per cluster with its key and the running cost.

### 25c. Killing the run throws away everything already paid for

`writeProposals` is called at `:209`, **after** the loop. Kill it at cluster N
and the N-1 completed proposals — already billed — are gone.

Fix: write each proposal as it clears the anti-poisoning gate, or checkpoint.

### 25d. The retro id is the SIGNAL COUNT, not a retro counter

`commands/retro.ts:208`:

```js
const retroId = `retro-${String(all.length).padStart(4, "0")}`;
```

sift had 10 signals on its first run, so it wrote `retro-0010.md` — which reads
as "the tenth retro" and is not. This repo has 54, so today's file is
`retro-0054.md`; it is the third retro. **Two retros run at the same signal
count overwrite each other's file.**

Fix: count retro-log entries, or use the date.

### Also worth recording

`retro-0011.md` in sift was written **by hand by a worker**, not produced by
`wst retro`, precisely because the command never returned. Anything reasoning
about that file as tool output is reasoning about the wrong thing.

---

## 23. Decide what a minimal Whetstone is, and cut to it

**open** · the strategic item; everything else is downstream of this

The question raised while walking the code: *is this worth being a tool at all,
or would skills plus SDD plus several agents do the same job?*

**Three things a skill cannot do, by construction.** They are the whole argument
for a binary:

| | Why a prompt cannot |
|---|---|
| Set an exit code `git push` respects | A skill is a prompt. It cannot refuse a push |
| Deny a write **before** it happens | `lane-guard.mjs` returns `permissionDecision: "deny"` from a `PreToolUse` hook — the edit tool never runs. A prompt can only ask |
| Hash inputs and skip work | Needs state on disk and a contract about what a skip means |

The strongest statement of the thesis is in sift's own `e2e.md`, written by hand
in a foreign repo: *"That artifact is the point: **it replaces taking an agent's
word that the app works**."* Run five agents with skills alone and nothing stops
one from reporting that the tests pass.

**So the thesis holds. The size does not.**

```
Enforcement spine:
  gate 1155 + triage 414 + receipts 275 + checks 251
  + contracts 98 + ports 73 + diff 63 + paths 58     ≈ 2,400 loc

core/ total                                            8,273 loc
```

5,900 lines are not enforcement.

### Evidence of use, measured 2026-08-19

| Command | Evidence | Verdict |
|---|---|---|
| `gate` | 174 logged runs here, plus sift | **proven** |
| `prepare` | **5 `run/` branches in sift** — the field report's five workers | **proven** |
| `signal` | 54 signals here, 11 in sift | **used** |
| `status` `check` `triage` `events` | read-only, small, used throughout this review | **cheap** |
| `retro` | 3 here (one produced 8 proposals for $0.78), 0 completed in sift | **half-proven** |
| `init` | bootstrapped sift once | **used once** |
| `plan` | leaves no trace; no way to tell | **no evidence** |

### A candidate minimum

```
gate + triage + checks + receipts   ~2,400   irreplaceable
prepare + dispatch                    ~700   proven; the derived charter has a scar (sig-0041)
lane-guard.mjs                      1 hook   irreplaceable
signal + retro                        ~600   the loop; half-proven
init                                ~2,450   could this be a skill?
                                   ───────
                                    ~3,700   against 8,273 today
```

`init` alone is **30% of the core**, for a command run once per repository. It is
the first serious candidate. `plan` (375) is the second — no evidence of use, a
name that misleads (#19), and its only unique value is the "nothing covers these
paths" half.

**The framing to settle:** is Whetstone *a gate with accessories* or *a
platform*? It is written as the second and proven as the first.

### 23a. The concrete proposal: `init` becomes a skill, its guards become checks

Analysed properly rather than estimated. `init` is **2,415 loc**.

| Goes — an agent does it | loc |
|---|---|
| `interview.ts` — six questions become prose | 246 |
| `detect.ts` — reading `package.json` | 246 |
| `propose.ts` — the LLM draft; **the agent IS the LLM** | 243 |
| `plan.ts` — the orchestration disappears | 242 |
| `walk.ts` | 82 |
| `index.ts` + `artifact.ts` | 127 |
| `checks.ts` + `triage.ts` — templates and the compiler | 453 |
| `payload.ts`, its logic half | 180 |
| | **~1,820** |

| Stays — real guards | loc |
|---|---|
| `selfcontained.ts` — reference closure | 188 |
| `collisions.ts` — what init would destroy | 130 |
| | **~320** |

A further **172 lines of template do not disappear — they move** from
TypeScript literals to `.md` files, which is #10 resolved in the same stroke.

`core/` would drop from **8,273 to ~6,400**.

**But size is not the argument. This is:** the guards get *better* as checks.

Today `selfcontained.ts` audits the plan **once**, at init time. Hand-edit
`.wst/` a month later, write "see `docs/FOO.md`" for a file that does not exist,
and nothing catches it — the guarantee lasted exactly one command. As a
registered check over `.wst/**` it runs on **every gate, forever**.

Same for "no check names a command that does not exist". Today that holds
because `detect.ts` only ever reports a command it read. As a check it would
verify the registry against `package.json` on every run — and that is exactly
`sig-0043` from sift's field report: init seeding checks from unread
`package.json` scripts.

**Converting `init` to a skill turns one-shot generation guarantees into
permanent checks.** It is Whetstone applying its own thesis to itself: today
`init` is *trusted* to produce correctly; afterwards it is *verified*.

**Does the purpose survive?** Yes, unambiguously. The purpose rests on three
mechanisms and none of them is in `init`: the gate refuses a push, the lane
guard denies a write, receipts skip already-verified work.

**The risk, stated:** a skill can be ignored — an agent may skip a step where
`plan.ts` could not. The trade is deliberate: **generation becomes soft,
verification becomes hard.** A badly generated `.wst/` then fails a check and
gets fixed, instead of staying wrong forever because nothing looked again.

Secondary benefit: a payload of readable files makes the tool easier to
*evaluate*. Someone assessing Whetstone opens `.wst/` and reads the templates
rather than digging through TypeScript string literals.

Not a decision yet. What it needs is a few weeks of real use in sift, then this
table again with better numbers.

---

## 24. Apply retro-0054

**open** · 8 proposals waiting, nothing applied

`wst retro` ran on 2026-08-19 over 29 new signals: 10 clusters, 8 actionable,
$0.78, written to `.wst/memory/proposals/retro-0054.md`. Nothing is applied
until a human applies it.

Worth folding into this refactor rather than handling separately — several
overlap with items already here.

**Proposal 1 is the one to read first.** It synthesises 10 signals into one
rule for `xreview.md`: *"a check whose measured scope is narrower than the claim
it is trusted to back … ask what the check actually measured, not what it is
named."*

**That is exactly #22**, found by hand hours later and independently: `test`'s
`include` is narrower than what `npm test` reads, so a receipt authorised a skip
it never earned. The retro named the defect class from ten past instances; the
eleventh turned up the same day. **That is the clearest evidence in this document
that the loop works.**

The proposals also discriminate rather than pad — Proposal 2 states which
signals it deliberately did **not** fold in, and why. Worth checking that
property holds for all eight before applying any.

Also open: the sift retro clustered fine (11 signals, 5 actionable) but its full
run left no `proposals/` directory. Diagnosed in #25 — it was neither auth nor
network nor the filter, it was silence: up to 60 minutes of it.

### Do NOT apply retro-0054 as it stands

It was produced over a **stale cursor** (#25a) and is largely a re-run of work
already done and already paid for. The retro log shows:

```
## retro-0049
cursor: sig-cb978aef · 24 signals · 9 clusters, 7 actionable · $0.7283
```

That run covered through `sig-cb978aef`. Today's run could not parse that cursor
— hex id, trailing text — fell back to `sig-0025`, and its proposals cite
`sig-0026` through `sig-0045`: **the range retro-0049 had already processed.**
The same analysis, billed twice.

Order that fixes it: repair the cursor, re-run, then review proposals that are
actually about new signals. Applying a rule change is a human act either way,
but the reason to hold here is that **the input is wrong**, not the ceremony.

---

## 22. A receipt can authorise a skip the check never earned

**done** · reproduced live, then fixed by widening `test`'s `include` to what the
suite actually reads. Audited the other six: **only `test` had the hole** —
`adr-refs` already declares `.wst/**` and every other tree it walks, and
`docs-fresh`, `provenance` and `skill-shape` match what they read. Moving the
repo-invariant assertions out of the suite into their own checks stays the better
long-term shape and is now recorded in `test.md` itself.

A check's `include` is what invalidates its receipt. When a check's **real**
dependency surface is wider than the globs it declares, a receipt keeps matching
after something that changes the answer has changed — and the gate skips it.

Reproduced, three steps:

1. Edited a repo-root file that is **not** in `test`'s `include`. `npm test`
   now fails.
2. Ran `wst gate` over the same range:
   ```
   skipped  test           — receipt
   passed
   EXIT=0
   ```
3. Reverted; the suite passes again.

**The gate reported a pass on a tree where a blocking check fails.**

`test` declares `include: ["src/**/*.ts", "test/**/*.ts", "package.json",
"vitest.config.ts"]`. But `npm test` runs `test/definition-dir.test.ts`, which
scans **every file at the repository root**. No honest `include` can express
that, so the receipt is minted against a narrower input than the one that
decided the outcome.

### Where the defect actually is

Not in receipts — that mechanism does exactly what it promises. The defect is
that **a repo-wide invariant is enforced inside `npm test`**.
`definition-dir.test.ts` is a documentation check wearing a unit test's clothes.
While it lives there, `test`'s surface is the whole repository.

| Option | Cost |
|---|---|
| Widen `test`'s `include` to `**` | Any change invalidates the receipt; the 45-second check loses its cache entirely — which is the trade the narrow include was making on purpose |
| **Move the root scan out of the suite into its own registered check** | `test` gets a bounded surface back; the scan gets the `include` it actually needs |
| Accept it and reword | A receipt means *"passed for these files"*, not *"would pass now"* — but `skipped — receipt` reads as the second |

**Take the second.** It is cheap: move the assertion into a script and register
it, the same shape `adr-refs`, `docs-fresh`, `provenance` and `skill-shape`
already have.

**Worth auditing the other checks the same way:** any check whose command reads
more than its `include` names has this hole. `typecheck` is a candidate —
`tsc` follows imports and reads `tsconfig.json`'s `include`, which may reach
files the check does not declare.

---

## 20. Progress says a check started and then goes silent

**agreed** · observed live

`core/gate/progress.ts` exists because *"twenty-five seconds of nothing is
indistinguishable from a hang, and a Ctrl-C taken for a hang leaves half-written
receipts."* It solved half of that. Observed on a real cold run:

```
running  adr-refs        ← all three appear at once: deterministic checks are concurrent
running  test
running  typecheck
pass     adr-refs       (1.5s)
pass     typecheck      (3.5s)
                        ← 45 seconds of nothing while `test` runs
FAIL     test           (45785ms)
```

It announces that a check **started** and never says it is still alive. For the
one check that takes 45 seconds, that is the entire wait. A heartbeat, or an
elapsed counter on the slowest in-flight check, is what the module's own stated
purpose asks for.

Related, same module: it prints `running lens` for a check `--no-lens` will
immediately skip, and it times with `Date.now()` while the runner times with
`ports.clock.now()`, so the progress line and the report can disagree.

---

## 21. `events.jsonl` grows and nothing prunes it

**done** · `wst events` says it is disposable once the file is worth wondering about

172 KB over 174 runs — **~990 bytes per run**. At ten runs a day for two years,
roughly 7 MB.

Different from the signal question (#17) in one way that matters: **it is
gitignored.** It never travels, it is never reviewed in a pull request, and only
`wst events` reads it. It is local scratch for debugging.

So if it grows you delete it and lose nothing of value. **The problem is that
nothing says so:** there is no rotation, no `wst events --prune`, and no notice.
A user who finds a 7 MB file in `.wst/` has no way to know it is disposable.

Related, already known: because it is per-machine, **CI's runs evaporate with
the runner.** `AGENTS.md` records that as a weakness — the gate's own observations
about failures nobody staged are exactly the ones worth keeping, and those are
the ones that run in CI.

---

## 17. Growth: what happens after two years of signals

**open** · the numbers say the worry is real but aimed at the wrong thing

Measured today: **54 signals, 60,669 bytes — 1,123 bytes each.** 27 of 54 carry
`resolved_by`.

Projected: 1,000 signals ≈ 1.1 MB, 10,000 ≈ 11 MB. For a JSONL file in git that
is nothing. **Size is not the problem.**

The actual constraint is that **nobody can read 54 signals**, which is already
true. It does not get worse with scale; it is already past human scale. So the
question is not "how do I shrink it" but "what has to keep working":

| | Today |
|---|---|
| The retro clusters them | ✅ reads **from a cursor** (`shell/retro.ts:39`) — only new ones |
| Duplicates collapse | 🟡 `fingerprint` exists, machine-emitted signals only |
| **Finding "have we hit this before?"** | ❌ **does not exist** |

**That gap is the memory port's missing consumer** (#12). adr-0015 warns that a
port with no consumer is this project's named scope trap. Signal retrieval at
scale is the consumer — it does not have to be invented.

### Proposal: compact by lifecycle, do not archive

A signal has three states and only one needs full prose:

1. **Unresolved** — full prose. The retro's input.
2. **Resolved** — the amended rule now carries the lesson, so the signal's prose
   is redundant. Compact to a stub of roughly 200 bytes: `id`, `ts`, `type`,
   `resolved_by`, one line of detail.
3. **Retrieval** — the memory port's `search`.

Arithmetic today: 27 resolved × 1,123 → × ~200 saves ~25 KB of 60 KB, **~40%**,
and the resolved fraction only grows.

**Why compact in place rather than move to an archive file:** citations
(`resolved_by`, a check's `origin:`) must keep resolving. Moving a signal breaks
them unless the archive is also read — and then there are two readers of one
log again, which is the defect `core/signals/parse.ts` was written to end.

### The ADR side is already solved

Decisions are meant to be *read*, so volume matters more there — and adr-0019
already permits compaction and was executed once (19 entries folded into one
page).

A blanket "superseded → one line" would be wrong. `adr-0007` is superseded and
still runs 12 lines, and they are load-bearing: they say **which half of it
still stands** after adr-0019 replaced the other. That is the only thing a later
reader needs from a superseded decision.

So the rule is not "compact by status" but **"a superseded entry keeps what
still holds and drops what was replaced"** — which is what adr-0007 already
does. No change needed.

---

## Which `.wst/` files each command actually reads

Filled in as each command is read end to end. The point is to know when a
command depends on the definition layer and when it only looks at the directory.

| Command | Files read from `.wst/` |
|---|---|
| `status` | **none.** `definitionRoot()` is `join(repoRoot, ".wst")` — a path builder. `status` only `access()`es the *directory* and asks git whether it is tracked. It never opens a file inside. |
| `triage` | **`triage.yaml`** only — the compiled rule list. Not `triage-rules.md`, which is the human table adr-0005 declares the source; nothing parses it. |
| `check` | **`checks/*.md`, all of them.** `shell/sdd.ts:82` does `readdir`, then a `readFile` per file. Plus `checks/<id>.calibration.json` for any lens declaring `block` — and if that receipt is missing or does not re-hash, `registry.ts:104` **throws**: the registry refuses to load at all rather than dropping the check. |
