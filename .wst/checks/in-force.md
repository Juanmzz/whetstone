---
id: in-force
description: A decision that says it is not in force says so where a machine can read it.
kind: deterministic
severity: block
tiers: [strict, light]
include:
  - ".wst/memory/decisions.md"
command: npm run check:in-force
origin: [adr-0017, adr-0019]
version: 1
---

`accepted` records what was DECIDED. It has never said whether anything implements it,
and nothing ever checked. `adr-0006` read `accepted` for six weeks while no merge
existed, and the only places that was written down were a paragraph inside the entry
and a hand-maintained line in `AGENTS.md`.

Both are prose. A reader who scanned the status column believed the system did that.

**What it enforces.** An `accepted` entry whose body says "not in force" or "half in
force" must carry ` · unbuilt` after its date. One direction only: the marker without
prose is terse and fine, the prose without the marker is the drift.

`proposed` is exempt. It already says the decision is not in force, and a second
marker there would be noise.

**What it prints when it passes:** every entry carrying the marker. That list is the
one `AGENTS.md` used to keep by hand, which is the same failure one layer up: a claim
nobody can check is decoration.

**When it fails:** add ` · unbuilt` after the date. The meta line already accepts extra
fields, so nothing else moves.
