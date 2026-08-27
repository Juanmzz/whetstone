---
description: Bootstrap Whetstone in this repo: detect the stack, agree on what a bug costs here, and write .wst/. Use when the user asks to set up, install or initialise Whetstone, or when a repo has no .wst/ directory and they want the gate.
---

# Initialising Whetstone in a repository

Your job is the conversation, not the writing. `wst init` writes; you get the answers
right first. Getting them wrong is worse than not installing: the risk answer decides
how much ceremony every future change buys.

## 1. Check the ground first

```bash
wst status
```

If `.wst/` already exists, do NOT run `init`. It is not re-init, and it refuses
anyway. Run `wst update` instead: it re-plans from the answers the repo recorded and
reports what drifted, what a newer Whetstone writes differently, and what is gone. It
writes nothing, so reading it costs nothing.

If there is no `.wst/base.json`, `update` says so and stops. That repo predates the
recorded base; there is nothing to compare against and guessing would be worse.

Then look at what the repo already has, because it changes which flags you need:

- an `AGENTS.md` or `CLAUDE.md` → the repo has a harness. Use `--definitions-only`.
- a `.husky/` directory → husky owns `core.hooksPath`. **Never** tell them to run
  `git config core.hooksPath .githooks`; that disables it. Chain instead.
- a lint script that runs `--fix` → **do not register it as a check**. A gate that
  mutates the tree while judging it is worse than no gate. Say so and move on.

## 2. Let the repo answer what it can

```bash
wst init --dry-run
```

This writes nothing and prints what the repo declares about itself: package manager,
test command, typecheck command, whether tests exist. **Read the detection out loud.**
If the test command is wrong, everything downstream is wrong and nothing later will
catch it.

**In a terminal, `wst init` with no flags opens the interview itself** and the human
answers it in place. You are not the one filling it in. Your job is sections 2b and 3:
be the one who argues about the answers before they are written.

## 2b. Say what arrived switched off

`init` writes one check the repo did not ask for: `comment-density`, `enabled: false`,
with the signal that earned it elsewhere in its `origin`. It is an offer sitting in the
file tree, not a rule. Run `wst check` and it shows as `off`; `wst check run
comment-density` runs it once without enabling anything.

**Point at it and move on. Do not turn it on for them.** It is off precisely because
the day `init` runs is the day the answer to "do you want a comment ceiling?" is "I do
not know yet". Deleting `enabled: false` is a decision the repo makes the first time
the friction shows up.

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
whether to RETIRE the rule in a year. If you cannot write that sentence, the path
does not earn it.

Edit `.wst-answers.json` to match what they actually said, then either hand it to
`wst init --answers .wst-answers.json` or read it out and let them type the interview
themselves. **The draft is a starting point for the argument, never the answer.**

## 4. Write it

```bash
wst init --dry-run --answers .wst-answers.json   # read the list out loud
wst init --answers .wst-answers.json
```

If it refuses because of collisions, do NOT reach for `--force`. Read the list: those
are files somebody wrote by hand. Either use `--definitions-only`, or stop and ask.

## 5. Arm the gate, correctly

The gate is the only part that does not depend on an agent cooperating, so it is the
part worth getting right. **`wst init` already wrote `.githooks/pre-push`.** Do not
write it again; read it, and arm it.

Arming is deliberately not `init`'s to do, because `core.hooksPath` takes ONE value:

```sh
git config core.hooksPath .githooks
```

**Only if nothing else owns that setting.** Run `git config core.hooksPath` first. If it
already points at `.husky/_`, setting it disarms husky, and a repo that loses its
existing hooks to gain this one is worse off. In that case leave the setting alone and
add a `.husky/pre-push` that calls the same thing:

```sh
base="$(git merge-base origin/main HEAD 2>/dev/null)"
if [ -n "$base" ]; then
  wst gate --no-lens --range "$base..HEAD" || exit 1
else
  wst gate --no-lens || exit 1
fi
```

`wst status` reports whether the gate is armed, and says which of the two situations
you are in rather than guessing.

## 5b. If they have end-to-end tests, wire the ports

An e2e check that starts a dev server is the one kind that can pass **against the wrong
code**. Playwright's `reuseExistingServer: true` attaches to whatever is already
listening, and a port does not know which checkout started it, so a gate run in one
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
[0, 1000) derived from that path, stable per checkout, different between them.

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

## 7. Tell them how to check back

`wst update` is how they see, later, what they changed and what a newer Whetstone would
write. Say it once here; it is the command nobody thinks to look for.

## What not to do

- Do not run `wst init --force` to get past a collision.
- Do not register a mutating command as a check.
- Do not set `core.hooksPath` where husky or lefthook already owns it.
- Do not set an `llm` to `severity: block`. It will refuse to load without a
  calibration receipt, which needs `npm run calibrate` and ten runs per fixture.
- Do not answer the risk question for the user. Draft it, argue it, let them sign it.
