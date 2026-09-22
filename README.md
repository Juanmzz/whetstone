# Whetstone

**Check the work before handing it back.**

Whetstone finds what changed in a Git worktree, runs the project's applicable
checks, and reports what passed, failed or could not be verified. Configuration
is plain files under `.wst/`, versioned with the project.

## Use

```bash
npm install -g @juanmzz/whetstone
cd your-repo
wst init
wst ready
```

Node 22.12 or newer. `init` reads the test, typecheck and lint commands the repo
declares, asks about risk and code paths, and shows a plan before writing.
It probes those commands; a command that does not pass starts as a warning.

A new installation creates configuration, triage rules and available checks.
It installs no hooks, agent instructions, skills or memory system. Ask your
agent to run `wst ready` before handing work back, or connect verification to
your existing CI. `wst status` inspects the installation, not the change.

## Read the result

| Result | Meaning | Exit |
|---|---|---|
| `READY` | Verification completed under the configured policy. Failed warnings and omitted advisory checks remain visible. | 0 |
| `NOT_READY` | A blocking check ran and failed. | 1 |
| `INCOMPLETE` | Verification could not finish, a required check was omitted, coverage was declined, or nothing verified the change. | 2 |
| `NO_CHANGES` | Nothing changed against the reported base. | 0 |

`ready` resolves its base from local Git references and includes committed,
staged, unstaged and untracked changes. It refuses unresolved conflicts and
reruns checks without trusting cached receipts. It never fetches; use
`--range main..HEAD` when CI needs an explicit commit range.

```bash
wst ready --json   # semantic result, scope, check results and warning IDs
wst ready --fast   # omit slow checks; blocking omissions leave INCOMPLETE
wst ready --lens   # also run configured model reviews
```

No lens is installed by default. A lens cannot review untracked content yet:
stage those files and rerun. An explicit commit range covers committed work
only. Tests, types and lint only prove what they check; readiness does not
guarantee that the requested feature is complete or visually correct.

## Try it on one project

Start with a project that already has tests and a typechecker. Review what
`init` proposes, use `ready` for several real tasks alongside your usual checks,
and compare scope, findings and time spent. In an isolated copy, introduce one
known failure at a time, confirm detection, fix it and confirm recovery.
Add automatic enforcement after this pilot.

## Other commands

`check` and `triage` are diagnostics. `gate` remains compatible with existing
hooks and CI, including its receipt cache and push policy. Unlike `ready`,
an uncovered change may pass the gate. `signal`, `retro` and `update` remain
on standby for existing installations; `config` is removed.

- [Architecture](docs/architecture.md)
- [Decisions](.wst/memory/decisions.md)
