# Wizard-of-Oz era — reference specs

> **The definition directory is `.wst/` now, not `.sdd/` ([ADR-0012](../../.wst/memory/decisions.md#adr-0012)).**
> The files below still say `.sdd/` because that is what they specified at the time, and
> rewriting a superseded document to look current is how it gets mistaken for current.
> Read the name, not the procedure.

These files ran Whetstone before it had code. `init.md` and `retro.md` were executed **by an agent**,
by hand, against real repos — that is what "Wizard of Oz" means here: fake the machine until you know
it is worth building. `retro.md` produced TD6 on a real project, which is the validation
[ADR-0008](../../.wst/memory/decisions.md#adr-0008) rests on.

They are kept **tracked**, not archived, because they are the working specification for the code that
replaces them:

| File | Role now |
|---|---|
| `SPEC.md` | The `.sdd/` layout and schemas (the old name — see the note above). Input to **Step 1** (check registry / loader). |
| `init.md` | The behaviour `wst init` must reproduce. **Step 6**. |
| `retro.md` | The behaviour `wst retro` must reproduce, incl. the anti-poisoning gate. **Step 7**. |
| `OPEN_QUESTIONS.md` | Still live — #3 (concurrent `signals.jsonl` writes) bites at **Step 3**. |

Do not treat these as current procedure. Where they disagree with `.wst/architecture.md` or a recorded
ADR, the ADR wins. When a step ports one of these to code, note it here.
