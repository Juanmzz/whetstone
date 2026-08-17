---
description: Bootstrap Whetstone in this repo — detect the stack, agree on what a bug costs here, and write .wst/. Use when the user asks to set up, install or initialise Whetstone, or when a repo has no .wst/ directory and they want the gate.
---

# Initialising Whetstone in a repository

Your job is the conversation, not the writing. `wst init` writes; you get the answers
right first. Getting them wrong is worse than not installing: the risk answer decides
how much ceremony every future change buys.

## 1. Check the ground first

```bash
wst status
```

If `.wst/` already exists, STOP and say so. `init` is not re-init.

Then look at what the repo already has, because it changes which flags you need:

- an `AGENTS.md` or `CLAUDE.md` → the repo has a harness. Use `--definitions-only`.
- a `.husky/` directory → husky owns `core.hooksPath`. **Never** tell them to run
  `git config core.hooksPath .githooks`; that disables it. Chain instead.
- a lint script that runs `--fix` → **do not register it as a check**. A gate that
  mutates the tree while judging it is worse than no gate. Say so and move on.

## 2. Let the repo answer what it can

```bash
wst init
```

This writes nothing. It prints what it detected and the three questions the repo
cannot answer. Read the detection out loud to the user — if the test or typecheck
command is wrong, everything downstream is wrong.

## 3. Draft the answers, then argue about them

```bash
wst init --propose
```

The judge drafts `purpose`, `risk` and `strictPaths` from evidence it can cite, and
writes `.wst-answers.json`. It costs about $0.15.

**Then do the part that matters: go through the risk answer with the user, out loud.**

`risk` is not a fact about the code. It is a statement about what they are willing to
lose, and every ceremony downstream hangs off it. Marking all five flags on a personal
side project buys a wall of process nobody will keep. Marking none on something that
moves money is a lie the tool will faithfully enforce.

Ask directly: *"if this broke silently for a week, what would it cost you?"*

For `strictPaths`, keep it to two or three. A strict path means full TDD, every time,
forever. Each one needs a reason that would still make sense to somebody deciding
whether to RETIRE the rule in a year — if you cannot write that sentence, the path
does not earn it.

Edit `.wst-answers.json` to match what they actually said.

## 4. Write it

```bash
wst init --dry-run --answers .wst-answers.json   # read the list out loud
wst init --answers .wst-answers.json
```

If it refuses because of collisions, do NOT reach for `--force`. Read the list: those
are files somebody wrote by hand. Either use `--definitions-only`, or stop and ask.

## 5. Arm the gate, correctly

The gate is the only part that does not depend on an agent cooperating, so it is the
part worth getting right.

With husky already present:

```bash
echo 'wst gate --no-lens || exit 1' >> .husky/pre-push
```

With no hook manager at all:

```bash
mkdir -p .githooks
printf '#!/bin/sh\nwst gate --no-lens || exit 1\n' > .githooks/pre-push
chmod +x .githooks/pre-push
git config core.hooksPath .githooks
```

`--no-lens` deliberately: a hook that costs money and fifty seconds on every push gets
bypassed with `--no-verify`, and a routed-around gate has negative value.

## 5b. If they have end-to-end tests, wire the ports

An e2e check that starts a dev server is the one kind that can pass **against the wrong
code**. Playwright's `reuseExistingServer: true` attaches to whatever is already
listening, and a port does not know which checkout started it — so a gate run in one
worktree can verify another's tree and report green. That is worse than a broken check,
because it is indistinguishable from a working one.

The gate hands every check two variables. Use them in their config:

```js
// playwright.config.ts
const gated = process.env.WST_GATE_CWD !== undefined;
const port = 3000 + Number(process.env.WST_GATE_PORT_OFFSET ?? 0);

export default defineConfig({
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    port,
    // Never under the gate: a reused server may belong to another checkout.
    reuseExistingServer: !gated,
  },
});
```

`WST_GATE_CWD` is the checkout being verified. `WST_GATE_PORT_OFFSET` is a number in
[0, 1000) derived from that path — stable per checkout, different between them.

Say this out loud when you seed an e2e check. A repo that skips it gets a check that
sometimes lies, and nothing will tell them.

## 6. Show them it works

```bash
wst check     # what will judge them
wst triage    # what discipline their current diff earns
wst gate --no-lens --no-emit
```

Then commit only Whetstone's own files, never `-A`:

```bash
git add .wst .claude AGENTS.md CLAUDE.md
```

## What not to do

- Do not run `wst init --force` to get past a collision.
- Do not register a mutating command as a check.
- Do not set `core.hooksPath` where husky or lefthook already owns it.
- Do not set an `agent-lens` to `severity: block`. It will refuse to load without a
  calibration receipt, which needs `npm run calibrate` and ten runs per fixture.
- Do not answer the risk question for the user. Draft it, argue it, let them sign it.
