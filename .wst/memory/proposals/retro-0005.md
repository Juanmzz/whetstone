# Retro proposals

Signals sig-4a2610fb … sig-39f4aa1e (7 new).
**Nothing here has been applied.** Approving is a human act.

### Proposal 1, amend: .wst/skills/tdd-discipline.md

**Add a rule requiring the full `npm run verify` suite (typecheck, comment-density, docs-fresh) to be run before declaring any change complete, not just the test suite.**

The three signals are surface-different but share one root cause: changes were declared done and pushed without running the project's full local verification suite first, so each gate caught a different class of oversight late (excess comments, a stale AGENTS.md status line, a broken type in a test edit). None of these require a new check — `check:comments`, `check:docs`, and `typecheck` already exist and would have caught all three locally before the gate ever ran. The fix is behavioral, not tooling: tdd-discipline.md already governs the discipline of finishing work correctly, so it's the natural home for a rule that 'done' means 'full verify passes,' not just 'tests pass.' This is the smallest fix — no new hook or command needed since the checks already exist and just aren't being invoked at the right time.

- cluster: `type:gate-blocked`
- receipt: `sig-9ef87566`, `sig-bc543202`, `sig-39f4aa1e`

### Proposal 2, graduate-to-hook: .wst/hooks/checkout-uncommitted-guard.md

**Add a PreToolUse hook on Bash that intercepts `git checkout`/`git restore`/`git reset --hard` with a file argument, runs `git diff --quiet` / `git status --porcelain` on that path first, and blocks the command (asking for confirmation) if it would discard uncommitted work.**

sig-ea119c62 shows why hard rule 10 ("a deliberate break must be the only uncommitted change") cannot be enforced after the fact: by the time any diff or review step could run, the checkout has already executed and the work is gone. The only point where this is interceptable is before the Bash tool runs the command — a PreToolUse hook that pattern-matches destructive git commands and checks the target path's status first is a small, mechanical gate that closes exactly that window, and it's the kind of check code can actually perform (unlike style judgment).

I'm treating this cluster as two unrelated root causes despite both being tagged rule-ignored. sig-4a2610fb (comment brevity) is a qualitative rule — "brief and only where code cannot be clear" — that a hook can't reliably judge without high false-positive risk, and it was already applied by hand in PR #80, meaning it's a discipline/reminder problem, not a missing-gate problem. Forcing a hook onto it would be the wrong apparatus. I'm proposing only the git-checkout guard and leaving the comment rule as a skill-level concern for now rather than inventing a shaky lint gate for it.

- cluster: `type:rule-ignored`
- receipt: `sig-ea119c62`

### Proposal 3, amend: .wst/checks/correctness.md

**Add a documented recovery procedure for the calibration deadlock: when a block-severity lens's receipt is invalidated (even by an unrelated prose/formatting pass), `calibrate` refuses to load it, so its own suggestion to re-measure is unreachable. Document the sanctioned fix — temporarily set `severity: warn`, run `npm run calibrate`, restore `severity: block`, commit both together — directly in this file's calibration notes.**

The friction here isn't a bug in the gate logic (ADR-0008's unanimity requirement for block-severity is intentional) — it's that the recovery path exists only as tribal knowledge, discovered by trial after the error message pointed somewhere impossible. A hook or command change to make `calibrate` bypass its own gate would weaken the guarantee ADR-0008 established; that's the wrong fix. The smallest apparatus that prevents this friction from recurring is documenting the already-correct workaround as the canonical procedure, right where the calibration detail already lives, so the next person (or the same person, on a future formatting pass) finds the answer instead of re-deriving it. One signal isn't much evidence of a pattern, but the described deadlock is real and structural — it will recur on the next incidental edit to this file, not just on em-dash passes — so documenting it now is worth doing even off a single occurrence.

- cluster: `rule:checks/correctness.md`
- receipt: `sig-b828c2b1`

### Proposal 4, graduate-to-hook: .wst/hooks/git-destructive-guard.md

**Add a PreToolUse hook that blocks destructive git commands (checkout --, reset --hard, clean -f) on paths with uncommitted changes.**

The loss in sig-ea119c62 happened before any diff existed, so a review-time text rule in xreview.md cannot catch it; only a pre-execution hook that checks git status before running destructive git commands can.

- cluster: `rule:skills/xreview.md`
- receipt: `sig-ea119c62`

### Proposal 5, amend: .wst/skills/recording.md

**Add a note that unreproduced infra failures mentioned inside a calibration-passed signal should be filed as their own signal, not left as a dangling remark.**

This cluster is a single calibration-passed signal reporting a clean 100/100 unanimous run — that is a success, not recorded friction, so it does not really justify a process change. The only loose thread is a side remark that two 2026-08-20 infrastructure failures didn't reproduce and remain undiagnosed, but that fact isn't itself a signal in this cluster, just a note attached to a passing one. There's no recurrence pattern here to fix. I'm proposing the smallest possible amendment (a one-line addition to the recording skill saying stray unresolved-failure mentions inside other signals should be split into their own signal) mainly so the lack of justification is on record; expect this to be rejected, and if the undiagnosed infra failures resurface, they should generate their own signal cluster instead.

- cluster: `type:calibration-passed`
- receipt: `sig-3f92aae7`
