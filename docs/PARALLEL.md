# Working Whetstone in parallel

The check schema (`src/core/checks/schema.ts`) is now fixed, which is what makes fan-out safe.
Before it existed, Steps 2 and 3 would each have invented it and collided in the one place that
hurts most. This document is the contract and the split.

**Read first:** `docs/architecture.md` (the layers, the FCIS rule), `.wst/triage-rules.md` (`src/core/**`
is strict tier — full TDD, RED first).

## The rules that make parallel work safe

1. **One worktree per crewmate.** `treehouse` is installed. Never two agents in one working copy.
2. **Nobody edits `src/core/checks/schema.ts`.** It is the shared contract. If a lane genuinely needs
   a field, that is a conversation, not a commit — it invalidates the other lanes' assumptions.
3. **Ports are contracts too.** `src/core/ports.ts` is shared. Add adapters behind existing ports
   freely; changing a port signature is the same conversation as changing the schema.
4. **`core/` never imports `shell/`.** `test/architecture.test.ts` fails the build if it does.
5. **Every lane owns its own directory.** If two lanes need to touch the same file, the split is
   wrong — stop and re-cut it.
6. **RED first in `src/core/**`.** Not negotiable, and the strict-path-guard hook will remind you.

## The lanes

These are independent given the schema. Each is a full vertical: types, tests, module, wiring.

### Lane A — triage + routing (Step 2)
**Owns** `src/core/triage/`, `.wst/triage.yaml`, `src/commands/triage.ts`
**Consumes** `core/diff/parse.ts` (`ChangedFile[]`), `Check["tiers"]`, `Check["include"/"exclude"]`
**Delivers** `classify(files, rules) -> { tier, reason }` and `route(tier) -> { checks, autonomy, model }`

First-match-wins glob rules with a mandatory `reason`. **Tier is the MAX of files touched**; size only
escalates. Needs a glob matcher — pick one and note it, it is a shared dependency by implication.

### Lane B — receipts (Step 3, first half)
**Owns** `src/core/receipts/`, `src/shell/receipts.ts`
**Consumes** `GitPort.hashFile`, `Check["version"]`
**Delivers** `inputHash(matchedFiles, checkVersion) -> string`, plus read/skip/write-on-pass

Turborepo-style. The hash MUST include the check's `version` — otherwise editing a check's behaviour
silently reuses a receipt earned by the old one. Write only on pass.

### Lane C — the gate (Step 3, second half)
**Owns** `src/core/gate/`, `src/commands/gate.ts`
**Consumes** everything above, plus `LlmJudge`
**Delivers** `aggregate(results) -> { verdict: pass|block, blocking[], warnings[] }`

**The rule that must survive review:** only a real check failure may block. An infrastructure failure
(`error.kind` of `budget` / `timeout` / `spawn` / `auth` / `max-turns`) is NOT a failed check — it is
the gate being broken, and it must surface as such. `core/llm/verdict.ts` already draws that line;
do not blur it.

**Lane C depends on A and B.** Start it last, or stub their interfaces and reconcile.

### Lane D — harder calibration fixtures (independent, do it early)
**Owns** `test/fixtures/lens-correctness/`
**Delivers** fixtures where a competent reviewer would hesitate: a subtly wrong concurrency fix, an
off-by-one at a boundary, a change that is correct but looks wrong.

Currently the fixtures are mirror images and unambiguous, so the passing calibration proves the
harness works and the easy case is stable — not that borderline diffs are. Until this lane lands,
**no lens may be promoted to `severity: block`.** Cheapest lane, highest information.

## The contract

```ts
type Kind     = "deterministic" | "llm";
type Severity = "block" | "warn" | "annotate";
type Tier     = "strict" | "light" | "off";

interface Check {
  id: string;            // kebab-case, MUST equal the filename stem
  description: string;
  kind: Kind;
  severity: Severity;
  tiers: Tier[];
  include: string[];     // globs against changed paths
  exclude: string[];
  enabled: boolean;      // default true
  version: number;       // bump on behaviour change — feeds the receipt hash
  origin: string[];      // signals/ADRs that earned it
  command?: string;      // required iff kind === "deterministic"
  review_lens?: string;  // required iff kind === "llm"
  calibration?: { status: "uncalibrated" | "passed" | "failed"; runs: number; date: string; ... };
}
```

**Enforced at parse time, not run time:** an `llm` check declaring `severity: block` without a
passing calibration receipt is *refused by the loader*. Constitution non-negotiable 7 is a schema
rule so it cannot be forgotten under deadline. Verify with:

```bash
node dist/cli.js check     # after dropping an uncalibrated blocking lens into .wst/checks/
```

## Before you fan out

```bash
npm install && npm run typecheck && npm test   # 60 tests, no network, no cost
node dist/cli.js check                          # 3 checks, 2 blocking
```

Then `wst gate` (Lane C) is the checkpoint where Whetstone starts gating its own PRs — the first
point where this stops being scaffolding.
