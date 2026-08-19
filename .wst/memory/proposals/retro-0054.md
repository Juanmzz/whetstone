# Retro proposals

Signals sig-0026 … sig-6406e533 (29 new).
**Nothing here has been applied.** Approving is a human act.

### Proposal 1 — amend: .wst/skills/xreview.md

**Add a new "Review checklist" bullet (and bump to v4): a check whose measured scope is narrower than the claim it's trusted to back — cache keys that omit a hashed field, schemas that check presence instead of deriving from evidence, booleans collapsing more real states than they have values for, receipt stores that trust the party they audit, exit codes that diverge from the prose describing the same run, and unconstrained sample sizes on a measurement used to authorize. Ask what the check actually measured, not what it's named.**

10 of the 13 signals in this cluster are the same shape at different layers of the same codebase: a mechanism whose name or presence implied it verified a claim, but whose actual scope covered less than the claim — and in every case it was found by a human/external read or a live run, never by the project's own gate. sig-0028's receipt hash covered `version` but not `command`, so a changed test command still read as verified. sig-0034's calibration schema checked two hand-typed fields, not a derived measurement, so an uncalibrated lens could self-declare `passed`. sig-0030's `hooksInstalled` boolean couldn't distinguish "unconfigured" from "another tool owns this," so status gave destructive advice on a husky repo. sig-0027's gate stub ignored triage while `wst pr` used it, so two commands routed identically-shaped changes differently — and it failed SAFE, which is exactly why it went unnoticed for a whole PR. sig-0029's overwrite guard covered `.sdd/` but not the four other paths the same plan writes. sig-0033's "hermetic" judge was contaminated by the caller's global config for the file's entire life because the property was asserted in a comment and never probed. sig-0035's exit code said 0 for a run that verified nothing, even though the printed message was honest. sig-0036's gate trusted receipts minted by the same worker it was supposed to judge. sig-0039's calibration receipt was genuine but its sample size was unconstrained, so the cheapest passing measurement (`--runs 1`) granted the same blocking authority as a real one. sig-0040's flag typechecked and passed 570 tests while doing nothing, because wiring lived in a spot no test covered. This is XR5's own principle ("an unverified judge opinion is worth zero") applied one level up: it isn't just judge opinions that need grounding against real code, it's every check/gate/cache the judge is tempted to treat as already-settled evidence. The existing "Review checklist" section already carries one instance of this pattern (the unbounded directory walk, added v3) — this is the same kind of addition, not a new mechanism. I did not fold in sig-0026 (needs a testing off-switch, not a scope-audit), sig-0031 (prompt omission, caught by live run not by scope-mismatch), or sig-0038 (a specific silent-failure edit tool) — they support a different, narrower lesson each and forcing them under this one bullet would blur it.

- cluster: `rule:skills/xreview.md`
- receipt: `sig-0027`, `sig-0028`, `sig-0029`, `sig-0030`, `sig-0033`, `sig-0034`, `sig-0035`, `sig-0036`, `sig-0039`, `sig-0040`

### Proposal 2 — amend: .wst/skills/tdd-discipline.md

**Add TD10: a silent-on-failure edit (string-replace patch, sed, codegen mutation) must be verified at the call site — re-read or grep the changed region immediately, before reporting the change as done — because such tools return unchanged input with no error on a non-match.**

Of the 7 signals in this cluster, only sig-0038 names a gap the current v6 text doesn't already close. sig-0027, sig-0030, sig-0033 and sig-0034 are the exact citations TD8 already generalizes ("a stub justified as does not exist yet, a boolean modelling something with three states, and a config value inherited from another tool" — TD8's own worked examples). sig-e8dfefd0 is already resolved: TD2's current text ("One commit per coherent change, not one per phase") is the fix the signal asked for. sig-0043 is about init seeding checks from unread package.json scripts — a check-authoring/init-time failure, not a test-writing-loop failure, so it doesn't belong under this skill. sig-0038 is different in kind from TD7's existing "prove it landed" bullet: TD7 is scoped to negative tests proving a guard blocks a mutation; sig-0038 is a production-code patch applied with a non-asserting str.replace that silently no-opped, on a code path with zero test coverage (a one-off script), so no test — not even a well-written one — was in a position to catch it. The fix isn't "write a test," it's "verify the edit landed before claiming done," which is a distinct, smaller discipline TD7/TD8 don't state. Adding TD10 closes that gap without restating either.

- cluster: `rule:skills/tdd-discipline.md`
- receipt: `sig-0038`

### Proposal 3 — amend: .wst/skills/delegation.md

**Add [D10]: a delegate's charter/prompt content (paths, evidence, scope) must be derived from the same live computation used elsewhere in the dispatch, never a separately hardcoded list, and must be checked by at least one live run before being trusted — because unit tests can only prove what a prompt contains, never what it omits.**

sig-0031 and sig-0041 share a root cause that D1-D9 don't yet cover: both are cases where content handed to a delegate (a hermetic judge's evidence prompt in sig-0031, a dispatch charter's path list in sig-0041) was wrong not because of a missing inline-vs-path decision (that's D7) but because the content was asserted/hardcoded independently instead of derived from a single live source of truth, and the defect was invisible to the unit-test suite that shipped with it. sig-0031: 16 passing tests all asserted what the init prompt CONTAINS; none could catch that it OMITTED package.json/src file contents, and only a live dispatch surfaced the refusal. sig-0041: charter.ts hardcoded a literal strictPaths list instead of deriving it from the triage rules already loaded two lines above for gatingChecks — a duplicated-source-of-truth bug of exactly the shape the v4 changelog already names for sig-0036 ('one rule implemented twice and drifting'), just applied to charter construction instead of receipt validation. Neither is fixed by D8 or D9, which govern verification honesty and receipt provenance, not charter/prompt construction — so I did not restate those. sig-0035 and sig-0036 are already generalized by the existing D8/D9 (added in v4 for the same failure class), so I'm not re-citing them here; doing so would restate rules the skill already contains. The new D10 closes the gap: it requires charters to be computed once and reused, and requires a live run — not just unit tests — before trusting a delegate's prompt is complete, directly per sig-0031's lesson that 'the model will usually say so if the prompt gives it permission to admit ignorance,' but only if someone actually runs it.

- cluster: `rule:skills/delegation.md`
- receipt: `sig-0031`, `sig-0041`

### Proposal 4 — amend: .wst/skills/recording.md

**Add [RC9]: a decision (ADR) that deletes, replaces, or obsoletes a subsystem must list the prose documents describing it (e.g. architecture.md) as part of the decision entry, not just the code paths touched — the same coverage `rules_affected` already gives rules.**

Only sig-0045 root-causes to recording.md's actual scope (RC1, decision content). ADR-0009 deleted the GitHub client thoroughly at the code level but left architecture.md self-contradicting — one correct strikethrough, three stale mentions including a live roadmap entry — because nothing in the decision-recording discipline required naming affected prose. RC1 already asks for the rejected alternative because "git cannot reconstruct" it; the same logic applies to a deleted subsystem's write-up, which a `grep` for the removed code will never surface either. Adding a `docs_affected`-style requirement to decision entries closes that gap at the cheapest point: the moment the decision is written, not a later audit. sig-0037 and sig-0044 were included in this cluster but don't share this root cause — sig-0037 is a fixed backend-implementation bug in shell/signals.ts (already resolved via fingerprint-derived ids, and recording.md deliberately keeps backend mechanics out of the discipline layer), and sig-0044 is about a plugin hook's silence and belongs to a status/observability fix (`wst status`), not to what/when/who of recording. Forcing all three into one recording.md rule would blur a real, actionable fix with two unrelated ones, so I'm citing only the signal that justifies this specific amendment.

- cluster: `rule:skills/recording.md`
- receipt: `sig-0045`

### Proposal 5 — amend: .wst/skills/voice.md

**Add one boundary-clarifying line to voice.md's scope paragraph, explicitly stating that artifact-facing output quality — branch names, CLI progress feedback, code-comment density — is out of scope for this skill, rather than adding a new V-rule to cover the cluster.**

This cluster does not justify a behavioral change to voice.md. Voice's own opening line is explicit: "This governs REPLY TEXT only; it never leaks into code, UI strings, or committed prose." None of the three signals are about reply text: sig-0032 is a code bug in `branchNameFor` (already fixed, per the signal's own text — cut at word boundary, hard-cut fallback); sig-672d598d is code-comment density in committed source (voice.md explicitly routes committed prose to [[doc-locations]], not itself); sig-6406e533 is a CLI progress-output design gap in `wst gate`/`prepare`/`init` — a product/tooling feature, not conversational tone. Forcing a new V-rule onto voice.md to "cover" these would dilute a skill that is currently tight and well-scoped, and would misfile three unrelated root causes under one banner just because a clustering step grouped them. The three real fixes are already-shipped code (sig-0032), a comment-discipline concern that belongs near [[token-economy]] or doc-locations if it recurs, and a CLI UX gap that needs either a code change or its own ADR — none of which is "the agent should talk differently to the human." The smallest honest apparatus here is a one-line scope clarification in voice.md so future retros don't re-attempt this same mis-fit; I'm not inventing a new skill or ADR on the strength of a three-signal cluster that shares no actual root cause.

- cluster: `rule:skills/voice.md`
- receipt: `sig-0032`, `sig-672d598d`, `sig-6406e533`

### Proposal 6 — graduate-to-hook: .wst/hooks/sync-agents-status.md

**Add a pre-commit hook that regenerates the AGENTS.md status line (ADR/signal/command counts) automatically, instead of relying on humans to update it by hand before the docs-fresh check runs.**

Two of the three signals (sig-a9ff00c4, sig-5c2d6751) are the same failure recurring across separate changes: the AGENTS.md status line's counts drift stale and `docs-fresh` blocks the gate. Both check outputs even say "Every number in it is one command away" — meaning the counts are mechanically derivable, so this is pure manual-sync toil, not a judgment call. A rule/skill reminding someone to update it hasn't stopped it from recurring twice; escalating to a hook that recomputes and rewrites the status line before the docs-fresh check runs removes the possibility of drift entirely. I excluded sig-6f2d2b95 — its failure is a `test` gate error in fake-bin.ts (ENOSYS-style write failure), an unrelated test-infrastructure issue with a different root cause, not a docs-freshness problem.

- cluster: `type:gate-blocked`
- receipt: `sig-a9ff00c4`, `sig-5c2d6751`

### Proposal 7 — amend: .wst/skills/doc-locations.md

**Add [DL9] to doc-locations.md: closing a behavior-altering change requires grepping the doc set for what changed and fixing every hit, because no field like rules_affected exists for prose.**

Both signals are the same failure DL7 already names ("prose describing the tool's own behaviour is part of the change that alters it") recurring anyway — DL7 states the principle but gives no mechanism to act on it. sig-0045 says it explicitly: "the rules_affected field exists for rules; there is no equivalent pointer for prose." sig-0042 is the same gap from the other direction — generated prose baked for one mode shipped in another, because nothing forced a check against the doc set before the change was considered done. Rather than add a new field to some ADR schema (bigger apparatus, and ADR templates aren't owned by this skill), the smallest fix is a rule that supplies the missing mechanism DL7 lacks: before closing a behavior-altering change, grep the doc set for the name of what changed and fix every hit. This is a rule amendment, not a hook, since it's a discipline step an agent can be instructed to take on every ADR/mode change without new tooling. I did not restate DL7's content — DL9 adds the "how" (grep the doc set as a concrete check) that DL7 doesn't specify, and explicitly calls out that this is needed because no rules_affected-equivalent exists for prose.

- cluster: `rule:skills/doc-locations.md`
- receipt: `sig-0042`, `sig-0045`

### Proposal 8 — generate: .wst/adr/status-hooksarmed-path-comparison.md

**Record ADR mandating that `wst status`'s hooksArmed check compare resolved absolute paths instead of a literal string match against '.githooks'.**

sig-4b3339fb is a single high-severity signal, but it points to a concrete root-cause defect: hooksArmed does `configuredPath === '.githooks'` (literal string equality) instead of resolving core.hooksPath to an absolute path and comparing against the resolved Whetstone hooks path. This produces a false negative even when Whetstone's own hook is correctly armed, and the resulting warning actively misleads the user into thinking a *different* tool is installed. This is a code-correctness bug, not a recurring behavioral/process gap, so it doesn't warrant a new skill, a hook, or a command — those apparatuses govern agent behavior, not fix internal tool logic. With only one occurrence recorded, the cluster doesn't yet justify broad process change; the smallest durable artifact is an ADR that documents the defect and commits to the correct comparison semantics (path resolution/normalization, not literal equality), so any future implementation change is anchored to a recorded decision rather than re-litigated. If a `.wst/skills/verify.md` or equivalent already exists in the repo, this ADR should instead be folded into an amendment there — but it isn't among the listed skills, so generating the ADR is the right-sized move.

- cluster: `type:status-false-negative`
- receipt: `sig-4b3339fb`
