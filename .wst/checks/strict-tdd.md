---
id: strict-tdd
description: "What an agent does on a strict-tier change: RED first, then GREEN, TRIANGULATE, REFACTOR, landed as one commit."
kind: method
severity: annotate
tiers: [strict]
include:
  - "src/core/**"
  - ".wst/skills/**"
  - ".claude/hooks/**"
origin: [adr-0018]
version: 1
---

Selected when a diff touches `src/core/**`, `.wst/skills/**` or `.claude/hooks/**`: the three
globs `.wst/triage.yaml` marks `strict`. Tier is the MAXIMUM of the files touched, so one
strict file makes the whole change strict, and size only escalates
(`.wst/triage-rules.md`).

The gate does not verify any of this (adr-0018). It is what you do.

**The loop.**

1. Write the failing test FIRST. Read the failure before writing the fix, and confirm it
   failed on a logical assertion and not a compile error ([TD1]).
2. Write the minimum code to pass. No extras, no cleanup ([TD2]).
3. Triangulate: a second test with semantically different data (boundary, edge case,
   alternate path), to kill a hardcoded implementation. Strict only. If it fails, return to
   step 2 ([TD3]).
4. Refactor with the tests as the safety net. No new behaviour, green throughout ([TD4]).
5. Commit once, for the coherent change. RED and GREEN land together ([TD2], AGENTS.md hard
   rule 4).

**Each test.** Name it for behaviour, not implementation ([TD5]). Arrange / Act / Assert as
three blocks with a blank line between them, one act per test ([TD9]). Drive the unseeded
production path, never only a fixture seeded for convenience ([TD6]). Prove a guard in BOTH
directions: one case it must reject, one legitimate case it must let through ([TD7]). Treat a
claim about the system as a hypothesis until a test would go red if it were false ([TD8]).

**Do not.**

- Do not split RED and GREEN across two commits. That writes a commit whose suite is red by
  construction, and the discipline is that the test came first, not that the failure got its
  own SHA ([TD2], AGENTS.md hard rule 4).
- Do not quote the red output in the commit body. `tdd-discipline` v7 dropped it: it is a
  claim nothing can check.
- Do not drop to light because the change looks small. The classification comes from the
  path, not the size (`tdd-discipline` §Levels, `.wst/triage-rules.md`).

**Where every line above comes from.** Nothing new is prescribed here. The globs are
`.wst/triage.yaml`; the loop and the bracketed rule ids are `.wst/skills/tdd-discipline.md`
v7; the commit shape is AGENTS.md hard rule 4. adr-0018 is why it is a check and not more
prose: a skill is not selected by changed paths, so nothing could answer "which discipline
applies to THIS diff" at the moment the answer is needed.
