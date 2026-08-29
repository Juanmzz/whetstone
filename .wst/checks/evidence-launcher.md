---
id: evidence-launcher
description: A change to the launcher owes a capture of it running, beside the worktree.
kind: deterministic
severity: block
tiers: [strict, light]
include:
  - "src/core/tui/**"
  - "src/commands/home.ts"
  - "src/banner.ts"
command: npm run check:evidence -- evidence-launcher
skippable: false
origin: [adr-0036]
version: 1
---

The first evidence check (adr-0036). Every other check here reads the DIFF: `test` runs
the suite, `typecheck` compiles, `correctness` reads the change. A green gate says nothing
broke. None of them says what the launcher now looks like, so whoever reviews it
reconstructs the screen from source.

**It requires, it does not judge.** The gate asks whether the artifact is there, is not
empty, and is not older than the code it claims to show. Whether the screen looks right is
a human's call at the end of the loop. A lens over screenshots would be a judgment check
owing its own calibration before it could block (non-negotiable 2), which is a separate
project; requiring existence delivers most of that value for none of the cost.

**Where it lives, and why not here.** Beside the repo, never inside it:

```
<parent of the main checkout>/.wst-evidence/<repo>/<branch>/evidence-launcher/
```

For this repo on `main` that is `../.wst-evidence/whetstone/main/evidence-launcher/`. Drop
any number of files in it. Keyed by BRANCH because two branches have different evidence,
and hung off the COMMON git dir so every linked worktree of the repo shares one store.

Outside the repo is the whole point. Committed, a screenshot per branch poisons the history
of every repo that adopts this, and the payload must not make a target repo worse
(adr-0004). Attached to the PR, it reopens the annotation adr-0009 removed. Uncommitted but
inside the tree, it is dirt in the diff the gate is judging.

**Freshness is per directory, not per file.** The NEWEST artifact must be at or after the
newest mtime among the changed files this check matched. Adding a second capture beside
last week's has still shown the current code; nothing here forces a tidy-up.

**Shape, where a machine can read it.** `.json`, `.txt`, `.log`, `.md`, `.http` and `.csv`
get their contents checked: non-blank, and JSON must parse and hold something. `{}` is an
artifact that says nothing. Images and video get existence and a non-zero size, because
that is the honest limit of what a deterministic check can say about them.

**What this check does NOT run in: CI.** The store is local by design, so an ephemeral
runner has none, and mtimes on a fresh clone say nothing about when anything was made. A
change to these paths will therefore report `evidence-launcher` failing in this repo's own
workflow, where no edit can clear it. That is a real open edge and it is stated here rather
than papered over: the registry has no environment axis — `include`, `exclude`, `tiers` and
`enabled` say which PATHS a check covers, never WHERE it can answer — so the honest fix is
a gate-level way to skip it, the shape `--no-lens` already has, and that is a decision
nobody has made. `wst` ships no CI workflow, so this costs a bootstrapped repo nothing.

**When it fails:** run the launcher, capture it, put the file in the directory the failure
prints. `wst check run evidence-launcher` asks the same question outside the gate.

**The cost adr-0036 accepted:** a required artifact nobody looks at is ceremony, and this
check cannot tell the difference. If captures pile up in that directory and never get
opened, that is a signal, not a success.
