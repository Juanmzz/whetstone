# Retro proposals

Signals sig-0026 … sig-cb978aef (24 new).
**Nothing here has been applied.** Approving is a human act.

### Proposal 1 — amend: .wst/skills/xreview.md

**Add a corollary to [XR2] (fresh-context judge) requiring that isolation be probed, not merely configured — ask the judge to enumerate what context it can see before trusting its verdict.**

sig-0033 shows the exact failure XR2 exists to prevent, happening silently at the mechanism XR2 relies on. XR2 says the judge "must run in fresh context" and names shared context as the thing that "defeats the purpose even if the judge is nominally a different model." The hermetic-judge implementation asserted exactly this property in a comment (Hard Rule 9) and configured for it via --strict-mcp-config/--settings/--tools "" — but --settings only overrides the project layer, so the judge silently inherited the caller's user-level CLAUDE.md, global rules, a SessionStart hook, and directory-indexed auto-memory. It was found not by review or test but by asking the judge to enumerate its own context and reading an impossible line in its verdict ("prior sessions record you also use this repo as a practice sandbox"). That is a load-bearing gap in XR2 as written: the rule states the requirement but gives no mechanism to confirm it holds, so a fresh-context claim is currently trusted the same way XR5 already warns against trusting an unverified judge opinion — "an unverified judge opinion is worth zero" applies just as much to the judge's own isolation as to its findings. This is the smallest fix: one corollary bullet under the existing rule, not a new rule, hook, or skill, mirroring the sub-bullet style already used under XR5 for the identical shape of problem ("ground the verification itself, not only the claim"). I'm citing only sig-0033, the signal that directly falsifies an XR2-adjacent claim in practice; the other 12 signals in this cluster concern gate/calibration/receipt/CLI-wiring mechanisms outside xreview's scope and don't independently justify a change to this file, so I'm not force-fitting them here.

- cluster: `rule:skills/xreview.md`
- receipt: `sig-0033`

### Proposal 2 — amend: .wst/skills/tdd-discipline.md

**Add [TD8]: a claim about system behavior — a stub's "doesn't exist yet" justification, a boolean modelling an external tri-state, a "hermetic"/"enforced by the schema" property, or a seeded config value inherited from another tool — is a hypothesis, not a fact, until a test probes it directly and would fail if the claim were false.**

All six signals share one epistemic shape, distinct from TD6 (real path vs. fixture) and narrower TD7 (guard proven bidirectionally, mutation confirmed landed): a claim about system behavior was written down — in a stub's justifying comment (sig-0027), a boolean's implicit semantics (sig-0030), a security-property comment (sig-0033), a schema/architecture claim of "enforced by X" (sig-0034), an assumed patch outcome (sig-0038), or an assumed script's behavior from its name (sig-0043) — and nothing in the test suite or gate ever checked whether it was still true. Every one of them was found stale or false only by a human or an external agent reading code, months or PRs later, never by the gate that exists to catch exactly this ("the gate cannot catch this class" — sig-0027; "found by an external agent... not by any test, review or retro" — sig-0034). sig-0033 states the generalizable lesson almost verbatim: "a security property asserted in a comment and never probed is a hypothesis... Probe the boundary." sig-0043 gives the same shape for config: "the existence of a script is not evidence of what it does." TD7 already mandates proving guard mutations landed, but sig-0038 shows that exact discipline lapsing on a non-guard, non-test code path ("the discipline existed and was applied unevenly") — evidence the current rule is scoped too narrowly (guards/tests only) to cover claims embedded in stubs, models, and seeded config. TD8 generalizes TD7's core move — don't trust that a change did what its comment says, prove it — to any stated claim, closing the gap that let five of these six signals persist silently for the life of a file. This is a rule-only fix: no new command, hook, or ADR is needed, since the fix is "write the falsifying test," which is already the skill's job to prescribe.

- cluster: `rule:skills/tdd-discipline.md`
- receipt: `sig-0027`, `sig-0030`, `sig-0033`, `sig-0034`, `sig-0038`, `sig-0043`

### Proposal 3 — amend: .wst/skills/delegation.md

**Extend D8 and add a new D9: a verification boundary is only real if (a) every machine-read output at that boundary — exit code, not just message — encodes the true state, and (b) the receipt/evidence a gate trusts cannot have been authored by the party under judgment. Add a sub-bullet to D8 requiring exit codes to match the honest-message rule already stated, and a new D9 requiring a non-writable (e.g. null/no-persist) receipt store whenever gate and worker share a worktree.**

sig-0035 and sig-0036 are the same failure at two layers of the same delegation boundary. In sig-0035, `report.ts` printed the honest message D8 already mandates ("nothing about this change was verified") but `exitCodeFor` returned 0 anyway — the rule was satisfied in prose and violated in the one channel CI and other agents actually read. In sig-0036, the gate that's supposed to judge a crewmate independently instead honoured receipts the crewmate itself had written into a file it had write access to; `parseReceipt` checked shape, not who produced it, so a worker one step from charter.ts's own line — "a worker that can merge its own work has no gate" — could mint the evidence its gate trusted. Both are instances of one gap the current D8 doesn't cover: D8 only constrains the human-readable message ("no checks ran" vs "all checks passed"); it says nothing about the exit code other readers consume, and nothing about who is allowed to author the receipt that "skipped by receipt" relies on. Both were caught only by dispatching a real crewmate against the gate, not by unit tests — consistent with sig-0031's lesson that hermetic/automated checks can't see what a live adversarial run exposes, though I'm not citing sig-0031 here since its defect (evidence omitted from a judge's prompt) is a different root cause than evidence being falsified by the judged party; folding it in would blur two distinct fixes. sig-0041 is likewise a real but separate problem — a dispatch charter hardcoding stale literal paths instead of deriving them from the same source of truth used elsewhere — and deserves its own amendment rather than being stretched to fit this one. This amendment is the smallest fix that closes both cited signals: extend existing D8 rather than write a new philosophy, and add one new numbered rule (D9) only because "don't trust a receipt store the subject can write to" has no existing home in the skill.

- cluster: `rule:skills/delegation.md`
- receipt: `sig-0035`, `sig-0036`

### Proposal 4 — amend: .wst/skills/recording.md

**Add RC9: an ADR that removes/replaces a subsystem must enumerate the prose docs describing it (not just `rules_affected`) and isn't complete until those docs are updated.**

Of the three signals, only sig-0045 is direct root-cause evidence for a recording.md change: ADR-0009 deleted the GitHub-client subsystem and correctly struck it in one line of architecture.md, but three other mentions in that same file — one of the two docs the crewmate charter forces every dispatched agent to read — still describe it as live or upcoming. RC7 already gives decisions a mechanism for pointing at affected rules (`rule_affected`); the gap sig-0045 names explicitly is that there's no equivalent pointer for affected prose, so an ADR can be 'done' while the description of the deleted subsystem survives untouched in exactly the document new agents are required to trust. That's a rule-sized fix (a completeness check on RC1's ADR proposal step), not a hook or command — no external state needs watching, just a discipline addition. sig-0037 and sig-0044 are in the same cluster but don't independently point at recording.md: sig-0037's read-modify-write race was a signals.ts implementation bug already fixed in code, and sig-0044's fail-silent hooks need a `wst status` row, not a change to what/when the agent records. Both were left uncited rather than force-fit to this rule.

- cluster: `rule:skills/recording.md`
- receipt: `sig-0045`

### Proposal 5 — amend: .wst/skills/doc-locations.md

**Add rule DL7: docs that describe the tool's own behavior, mode, or a subsystem's existence must be kept in sync with the state/change that produced or altered them — no reusing prose calibrated for a different mode, and no deleting a subsystem's code without listing the docs that describe it.**

Both signals are the same root cause wearing different clothes: self-descriptive documentation (prose that asserts something about the tool's own current behavior or a subsystem's existence) drifted from reality because nothing forced it to update in lockstep with the change that invalidated it. sig-0042 is drift by mode — `--definitions-only` writes prose calibrated for the full-emitter path, so the reader is told a false story about what just ran. sig-0045 is drift by deletion — ADR-0009 removed the GitHub client's code but had no mechanism (equivalent to `rules_affected`) to enumerate the prose describing it, so architecture.md still asserts the feature exists in three places out of four. Neither is a misplacement of a doc (team vs personal), which is doc-locations.md's core concern, so this doesn't slot cleanly into the existing DL1-DL6 rules about *where* to save things — but the fit is close enough (both are about `.md` artifacts this skill governs) that a single added rule is cheaper than standing up a new skill or a hook to diff generated docs against code state. I did not propose a hook/command because there's no single mechanical check that would catch both cases (one is a generator-mode bug, the other is an ADR-authoring omission) — the fix is a habit change at doc-creation/doc-editing time, which is exactly what this skill format is for. If the human judges this belongs in a different skill (e.g. one about ADR authoring or generator correctness) rather than doc-locations, that's a reasonable rejection.

- cluster: `rule:skills/doc-locations.md`
- receipt: `sig-0042`, `sig-0045`

### Proposal 6 — amend: .wst/skills/voice.md

**Sharpen voice.md's existing scope line with concrete negative examples (generated identifiers like branch names, inline code comments) so future retro clustering stops routing artifact-quality lessons here.**

Neither signal is actually a voice.md gap. sig-0032 is about `branchNameFor` cutting mid-word in a permanent git ref; sig-672d598d is about a 0.35 comment-to-code ratio and 42-line comment blocks in core/calibration/receipt.ts. Both are generated ARTIFACTS — a branch name and inline code comments — and voice.md's own first paragraph already says it "governs REPLY TEXT only; it never leaks into code, UI strings, or committed prose (those follow [[doc-locations]])." So the rule as written already excludes both cases; there is no missing V-rule to add, and inventing one (e.g. "be careful with permanent output") would just restate the scope line in weaker form under a rules section that isn't the right home for it.

What the cluster does show is that the scope line is abstract enough that two clearly-artifact signals still got clustered against voice.md instead of doc-locations.md (or wherever comment-density and identifier-naming conventions actually live). The fix that matches the evidence is narrower than a new behavioral rule: name the two concrete cases these signals are examples of — generated identifiers and inline comments — directly in the scope sentence, so the exclusion is unambiguous to both a human skimming the skill and whatever process clusters future signals.

I expect this to be rejected or heavily trimmed by the human, per the "propose the smallest possible amendment anyway" instruction — the real fix is a clustering/tagging problem outside voice.md, not a skill-content problem. But this is the smallest defensible edit that's actually rooted in what these two signals show, rather than manufacturing a rule these signals don't support.

- cluster: `rule:skills/voice.md`
- receipt: `sig-0032`, `sig-672d598d`

### Proposal 7 — generate: .wst/adr/fix-hooksarmed-path-comparison.md

**Record the decision that `wst status`'s hooksArmed check must compare resolved/normalized paths, not a literal string match against '.githooks', to stop false-negative "pre-push NOT active" warnings.**

This is a single signal and it's a concrete code bug, not a recurring behavioral pattern a skill/hook rule can steer around — the root cause is that hooksArmed compares core.hooksPath against the string literal '.githooks' instead of resolving both to absolute paths before comparing, so a validly-armed Whetstone hook (configured via absolute path) is misreported as inactive, and the warning even wrongly implies another tool is active instead of Whetstone. Since no skill or hook in this project owns "wst status" verification logic, and the fix belongs in the comparison logic itself rather than in agent behavior, the smallest correct apparatus available under .wst/ is an ADR that pins down the required fix (normalize-then-compare) as a decision, since I cannot patch the tool's source through this retro mechanism. One signal is thin evidence, but it's high severity and directly reproducible from the description, so recording the decision now is warranted; if it recurs across more signals, this should graduate to an actual code fix/test rather than just documentation.

- cluster: `type:status-false-negative`
- receipt: `sig-4b3339fb`
