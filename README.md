# Whetstone

**Is this task ready? One honest answer for AI coding agents, from the checks your repo already has.**

`wst ready` finds what the task changed, runs only the checks those paths need, and
says `READY`, `NOT_READY`, `INCOMPLETE` or `NO_CHANGES`. The checks are plain files under
`.wst/`, versioned with your project.

```text
$ wst ready
  fail     test           (223ms)
  pass     typecheck      (168ms)

  Needs work

  base        HEAD at ebfc00ec
  unstaged    src/price.js

  FAIL  test               0.2s
        ✖ total sums price times quantity
          AssertionError: Expected values to be strictly equal:
          6 !== 13
  pass  typecheck          0.2s

$ echo $?
1
```

A real run on a scratch repo, trimmed. The agent broke `total()`, and `ready` named the test.

## Try it

```bash
npm install -g @juanmzz/whetstone   # Node 22.12 or newer
cd your-repo
wst init     # reads your test, typecheck and lint commands, shows a plan, writes .wst/
wst ready    # no arguments
wst status   # what is installed here, and whether the push gate is armed
```

`init` probes each command it finds; one that does not pass starts as a warning, not a block.

## Results

| Result | Meaning | Exit |
|---|---|---|
| `READY` | Verification completed under the configured policy. Failed warnings and omitted advisory checks remain visible. | 0 |
| `NOT_READY` | A blocking check ran and failed. | 1 |
| `INCOMPLETE` | Verification could not finish, a required check was omitted, coverage was declined, or nothing verified the change. | 2 |
| `NO_CHANGES` | Nothing changed against the reported base. | 0 |

`wst ready --json` gives the same answer as data. `--range main..HEAD` sets the commit
range for CI. `--fast` omits slow checks.

## Connect it to an agent

**Claude Code.** Add the marketplace, then install the plugin:

```text
/plugin marketplace add Juanmzz/whetstone
/plugin install whetstone@whetstone
```

Its Stop hook runs `wst ready` when the agent finishes. `NOT_READY` sends the agent back to
fix it, `INCOMPLETE` tells it nothing was verified, and `READY` stays silent.

**Any other agent.** Add one line to its `AGENTS.md`:

```text
Before handing work back, run wst ready and fix what it reports.
```

## Why not just CI

- It runs at the end of the agent's turn, not minutes later on a pushed branch.
- It runs only the checks the change needs, so it is fast enough to run every time.
- It says `INCOMPLETE` when it could not verify something, instead of passing what it did not check.

Tests, types and lint only prove what they check. Readiness does not guarantee the feature is
complete or looks right.

[Architecture](docs/architecture.md) · [Decisions](.wst/memory/decisions.md) · [Changelog](CHANGELOG.md)
