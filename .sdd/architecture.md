---
id: architecture
ts: 2026-08-07
status: active
origin: [adr-0005, adr-0008]
---
# Architecture

> Source of truth for how Whetstone is built. `AGENTS.md` points here; it does not restate this.
> Per ADR-0002, `.sdd/` is the vendor-neutral source and vendor files are rendered from it — so
> content belongs **here**, never in `AGENTS.md` or `CLAUDE.md`.

## The principle

Files alone would be advisory — the model reads them and hopefully complies. Whetstone is an
**engine (code)** driven by **declarative definitions (`.sdd/`)**, calling the LLM **only** where
judgment is irreducible.

- **`.sdd/` = DATA** (the *what*): constitution, triage, check registry. Git-versioned config.
- **Engine = CODE** (the *how*, deterministic): reads `.sdd/`, classifies (globs, not LLM), selects
  and runs checks, enforces the gate, writes receipts, collects signals, clusters the retro.
- **LLM = judgment only**: `agent-lens` checks, plan grilling, PR criticality annotation, proposing
  new checks (human-gated).

| Deterministic → ENGINE | LLM (judgment only) |
|---|---|
| triage classification · check selection · running deterministic checks · enforcing the gate · receipts (hashing) · signal collection + clustering · hooks | `agent-lens` checks · grilling/plan · annotating the PR by criticality · proposing a new check |

This buys reproducibility, testability, auditability, frugality, and trust — a non-negotiable
cannot be "forgotten".

**Frugality is about VERIFICATION, not execution.** The crewmate doing the task is inherent agent
cost (tier-routed, not free). The differentiator: we don't burn tokens verifying *everything* with
agents — we verify frugally, triage-gated.

## FCIS — Functional Core / Imperative Shell

```
src/
  cli.ts              commander wiring only, zero logic
  commands/           composition roots: build adapters, call core, print
  core/               PURE. no I/O. MUST NOT import from shell/
    ports.ts          Git · Fs · Clock · LlmJudge interfaces
    diff/             raw diff text -> changed files + content hashes
    llm/verdict.ts    validate an envelope -> accept | retry | fail
    orchestrate/      takes ports AS PARAMETERS; holds retry/sequencing policy
  shell/              IMPERATIVE. thin adapters, no branching logic
    exec · git · fs · claude
```

**The one-way import rule:** nothing under `core/` may import from `shell/`. Enforced by
`test/architecture.test.ts`, not by discipline.

**Be precise about what that proves.** The guard enforces import *direction*. It does not by itself
prove "LLM only for judgment" — that is upheld by the `orchestrate/` tier: orchestrators receive
ports as parameters, so judgment logic has a legitimate home in `core/` and does not accrete in
`commands/`, which nothing guards.

Consequence: mock `LlmJudge` and the core is 100% unit-testable. "LLM only for judgment" is an
architectural fact, not a promise.

## The layers

| # | Layer | Role | Status |
|---|---|---|---|
| 0 | **Definition** (`.sdd/`) | Per-project source of truth: constitution, triage, check registry, skills, memory | constitution/triage/skills ✅ · registry = Step 1 |
| 1 | **Apply** (`wst init`) | Interview the project → generate `.sdd/` + bootstrap the toolchain | WoZ validated (`docs/woz/init.md`) · code = Step 6 |
| 2 | **Triage / Routing** | Classify a change → criticality → {autonomy, model tier, which checks run} | Step 2 |
| 3 | **Execution seam** | Inject the charter into whatever executes. The plan gate lives here | Step 5 |
| 4 | **Verification gate** (lean) | Triage-gated: deterministic checks always, calibrated agent review only when critical. Receipts skip what already passed | Step 3 — the central build |
| 5 | **Reviewable output** | PR annotated by criticality + verification artifacts | Step 4 — the differentiator |
| 6 | **Self-sharpening** (retro) | Signals → distill → propose/tune/prune checks → human gate → amend | WoZ validated (`docs/woz/retro.md`) · code = Step 7 |

Cross-cutting: **memory** (tiered, behind ADR-0001's `save`/`search`/`summarize` port) and
**receipts** (skip re-work, audit, tamper-guard).

## The LLM verdict contract

Risk #1 of the whole design: `agent-lens` verdicts are **not deterministic**. A flaky check that
blocks legitimate work is worse than no check — the user stops trusting the gate and routes around it.

**The hard rule (ADR-0008):**
> Deterministic checks may `block` freely. An `agent-lens` check may `block` **only** after passing
> calibration: **correct and unanimous — 10/10 on a known-good AND a known-bad fixture, zero flips.**
> Anything less is capped at `warn`/`annotate`. Stability alone is not enough; a lens that stably
> passes everything is stable and useless.

Human override is always available.

### The validated `claude -p` invocation

Probed live against `claude` v2.1.224. **Do not simplify this command** — each flag was measured.

```
claude -p --output-format json --json-schema '<schema>' --append-system-prompt '<lens>' \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --settings '{"hooks":{},"outputStyle":"default"}' \
  --tools "" --model <haiku|sonnet|opus> [--max-budget-usd N]
```
Prompt goes on **stdin** — diffs exceed argv limits.

| Why | Evidence |
|---|---|
| Hermetic flags are mandatory | A naive call inherits the ambient config (250+ MCP tools, plugins, SessionStart hooks): **140,682 tokens / $0.84** for a one-word answer. Hermetic: **11.4k / ~$0.03–0.08**. ~10× cost, 92% context |
| Use `--append-system-prompt`, never `--system-prompt` | Replacing the system prompt **corrupted structured output** (`</parameter>` leaked into a string field). Append is *better*, **not clean** — see the row below |
| Do NOT use `--bare` | It forces `ANTHROPIC_API_KEY`/`apiKeyHelper` and never reads OAuth — it would bill separately and break the Max-subscription cost advantage |
| `--json-schema` is native validation | The result envelope carries a validated `structured_output` object |
| Contamination recurs even with append, and is SIZE-CORRELATED | **Corrected 2026-08-08 (sig-0008/0009).** The original "clean 2/2" was 2 runs on a one-line prompt. Over 80 runs at realistic lengths: **0/40 blind on diffs <10 lines, 13/40 on 11-15 line diffs**. The model closes its tool call inside the string, so the artifact is a well-formed TRAILING suffix with correct prose in front |
| Sanitise the tail, reject the middle | `core/llm/verdict.ts` strips trailing markup and reports it via `sanitized`; markup embedded mid-content still fails closed. Rejecting outright discarded correct verdicts and billed 3 retries into the same deterministic failure. Re-measured: **0/8 blind** |
| Retry is still required | Native validation is necessary, not sufficient — a payload can be schema-valid and unusable |
| `stream-json` needs `--verbose` | It errors without it. We use `json`, not `stream-json` |
| Cost metering is free | The envelope carries `total_cost_usd`, token counts, `duration_ms` |

This also generalises `NeutralizesGateInstructions`: the leak is not only the target repo's
`AGENTS.md`/`CLAUDE.md` — it is MCP servers, hooks, plugins, skills and output styles. The flag set
above neutralises all of them at once.

## Model-agnostic by construction

`llm/` is ONE port (`LlmJudge`). Agnosticism = multiple **adapters** behind it (claude/codex/…), with
`agent:` config selecting one. The core never knows the model. **Beta ships only the claude adapter**
(uses the Max subscription, no API key). Adding a model = one adapter, zero core changes.

## Build sequence

Step 0 skeleton **(current)** → 1 check registry → 2 triage/routing → 2.5 verdict calibration →
3 lean gate + receipts *(first real value: Whetstone gates its own PRs)* → 4 annotated PR →
5 `wst run` dispatch → 6 `init` → 7 `retro` *(loop closed)*.

Self-hosting: Whetstone's own `.sdd/` exists from Step 0; **self-gating starts at Step 3**, and
signals are emitted from then on so the retro has real volume to process.

Detail lives in `_design/WHETSTONE-BUILD-PLAN.md` (untracked working material).
