---
id: test
description: The test suite passes, with no network calls and no token cost.
kind: deterministic
severity: block
tiers: [strict, light]
include: ["src/**/*.ts", "test/**/*.ts"]
command: npm test
origin: [adr-0008, sig-0005, sig-0006]
version: 1
---

The default suite must stay free and offline. Live LLM tests are gated behind
`WST_LIVE_LLM=1` — a suite that costs money per run is a suite people stop running.

**When it fails:** read the failure before touching the test. Two of this project's own
signals came from tests catching real defects that looked like test problems:

- `sig-0005` — a payload that passed schema validation while carrying tool-call markup.
- `sig-0006` — a contamination guard so eager it would have rejected legitimate reviews
  of HTML/JSX.

Deleting or skipping the assertion would have shipped both.
