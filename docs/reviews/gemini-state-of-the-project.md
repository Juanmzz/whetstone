# Independent review: what is this project now, and is it ready to publish?

You are reviewing a working tool before its first public release. Do not summarise this
document back. Answer the questions at the end, and be adversarial about the answers.

You can read the repository. Start with `README.md`, `docs/architecture.md`,
`AGENTS.md`, `.wst/constitution.md`, and `.wst/memory/decisions.md`.

---

## What it claims to be

Whetstone captures a project's definition of *correct* as plain files in git, enforces
it with a deterministic engine that calls an LLM only where judgment is irreducible,
and grows the checks a project needs from the friction it actually hits.

The claimed differentiator is a closed loop: **use → record friction → distil →
amend the rules → use.** Comparable tools stop at the first arrow.

## Where it stands, measured

- **9 commands.** `init`, `update`, `gate`, `signal`, `retro` are the loop; `status`,
  `check`, `triage`, `opinion` read it back or run one rule.
- **936 tests.** Mutation score 85% over a 40-mutation sample.
- **8 checks** run on this repo. Seven can block; one is an LLM lens held at `warn`.
- **58 signals**, 5 of them written by the gate itself rather than typed by a human.
- **26 decisions**, 4 of which are `proposed` and explicitly marked not in force.
- `src/` is ~9,600 lines including blanks, excluding tests.

## What changed in the last three days, and why it matters to the review

Three commands were **cut**: `plan`, `prepare`, and `events` (adr-0023, adr-0024). The
argument was that `.wst/` is committed and travels with the repo, so a worker that can
read markdown already has the rules; a charter was a second copy that could drift.

`wst update` was added: `init` records a base (the answers, plus a sha256 per file it
wrote) and `update` re-plans from those same answers to report what drifted, what a
newer version writes differently, and what is gone. It writes nothing — deliberately,
as the starting point of adr-0006 rather than its fallback.

A second judge adapter (Gemini) was added, and a check may now name which judge runs
it. Two judges report side by side and never vote (adr-0026).

## The weaknesses the authors state openly

- **The LLM lens is at `warn`.** Its last calibration measured 98/100 correct with
  **zero wrong verdicts**; it failed only because two runs were infrastructure
  failures, and the bar demands unanimity. Those failures were traced to two error
  kinds that were never retried, which has been fixed — the bar was mathematically
  unreachable (a perfect lens passed 13% of the time) and is now reachable. **The
  re-measurement has not been run yet.**
- **The Gemini adapter has never run against the live CLI**, only against a captured
  envelope.
- **Four of the eight checks are Whetstone-only** and `init` seeds none of them. Nobody
  has asked what each last caught.
- **The plugin is not installed anywhere**, so the session-side hooks protect nobody.
- **Publishing to npm is decided and unbuilt** (adr-0010, `proposed`).

---

## Answer these

1. **The strongest attack.** A serious reader will say: *"if your only blocking checks
   are lint, tests and typecheck, this is a slow, complex wrapper around Husky and a
   three-line git hook."* Is that correct as the project stands today? What is the
   shortest honest rebuttal, and does the project currently have it?

2. **Is the loop real or is it decoration?** Look at `.wst/memory/retro-log.md`,
   `signals.jsonl` and the `origin:` field on each check in `.wst/checks/`. Find a rule
   that exists *because* something went wrong, and trace it. Then find one that does
   not, and say so.

3. **What would you cut**, given `plan`, `prepare` and `events` are already gone? Name
   anything still carrying its own weight badly. Argue from the loop, not from line
   count.

4. **What is missing that a first user would hit in the first hour?** Be concrete about
   the sequence: they install it, they run something, and then what.

5. **The record's honesty.** Four decisions are `proposed` with a line saying what is
   not in force. Is that discipline working, or is it a way to look rigorous while
   shipping less? Check whether any `accepted` decision is in fact unimplemented.

6. **Publish or not.** Given all of the above: would you make this repository public
   this week? If not, name the smallest set of things that changes your answer.

Where you are guessing, write "guess". Where you disagree with a decision in
`decisions.md`, engage its stated rejected alternatives rather than restating the
option it rejected.
