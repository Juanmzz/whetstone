---
id: architecture
ts: 2026-09-05
status: active
origin: [adr-0017, adr-0019, adr-0048, adr-0049]
---
# Architecture

Whetstone verifies a worktree before an agent or person hands it back. The product
path is `init`, `ready`, `status`. Decisions and rejected alternatives live in
`.wst/memory/decisions.md`; this page describes the implementation.

## Definition and installation

`.wst/wst.yaml` holds configuration, `triage.yaml` classifies paths by risk, and
`checks/` declares what can verify them. These are plain files in Git.

`init` reads declared repository commands, offers draft answers when a judge is
available, and asks about risk, source paths and strict paths. Every drafted
field must be visited before the interview can write. It probes the repo's
commands, presents a plan and writes definitions.

New installations create no skills, constitution, memory logs, vendor pointers,
agent instructions or hooks. Existing installations may still contain them.
Automatic execution requires the owner to connect verification to their workflow
or CI; `init` does not enforce that an agent invokes readiness.

## Readiness

`ready` resolves the task base from local Git references, computes the merge base,
and includes committed, staged, unstaged and untracked changes. It never fetches.
A detached HEAD or ambiguous base requires `--range`; an explicit commit range
covers those commits, not local untracked work. Unresolved conflicts prevent
verification even with a range override.

The shared verifier loads the registry and triage rules, selects matching checks,
executes eligible checks and returns outcomes. Omitted applicable checks remain
available to the readiness report with their reasons.

| Result | Policy | Exit |
|---|---|---|
| `NOT_READY` | A blocking check failed. | 1 |
| `INCOMPLETE` | An execution errored, a blocking check was omitted by `--fast`, coverage was declined, or nothing verified the change. Scope/configuration failures also produce this result. | 2 |
| `READY` | Verification completed under this policy. Failed warnings and advisory omissions remain visible. | 0 |
| `NO_CHANGES` | No changed files were found against the base. | 0 |

`ready` neither reads nor writes pass receipts. A command can depend on files
outside its triggering `include` globs; hashing only matched files cannot prove
that a previous suite result still applies.

`--fast` omits slow checks, `--no-evidence` omits checks requiring an unavailable
evidence store, and model reviews run only with `--lens`. A blocking check omitted
by `--fast` leaves readiness incomplete, since rerunning without the flag clears it.
One omitted by `--no-evidence` is reported as excluded and does not, since nothing
in that environment can clear it (adr-0038). A lens matching untracked files reports an error
without calling the judge; stage those files before requesting model review.

The report names the branch, base and resolved commit, splits files by Git state,
and lists check results. `--json` exposes a semantic `result` and warning IDs.
Stdout carries the report and stderr carries progress.

A check that failed or could not run reports `detail`, an array of lines. For a
command these are the last 40 non-blank lines it printed, with terminal escapes and
`node_modules` stack frames removed and about 4000 characters at most
(`core/gate/detail.ts`); a leading line counts what was cut. A model review reports
its reason, uncut. The text report prints the lines indented under the check.

`INCOMPLETE` and a `NO_CHANGES` in a repo with no `.wst/` carry `reason`
(`core/ready/incomplete.ts`): no `.wst/`, an empty registry, the checks that could
not run, the ones that applied and did not run with what would run them, and the
changed paths no check covers. `uncovered` lists
those paths in every result; `declined` lists the switched-off checks that would
have matched.

## Functional core, imperative shell

`src/bin.ts` is what `wst` resolves to: it refuses a Node below the `engines`
floor with one line and exit 2, then imports `src/cli.ts`, which wires commands. `src/commands/` composes adapters, core functions and
reports. `src/core/` owns deterministic policies: triage, selection, readiness,
aggregation, receipt hashing, interview transitions and validation. It never
imports `src/shell/` or calls a model.

`src/core/orchestrate/` drives ports supplied as parameters. `src/shell/`
adapts Git, filesystem storage, subprocesses and models. `shell/verify.ts` is
shared by `gate` and `ready`; their result policies differ.
`test/architecture.test.ts` enforces the dependency boundary.

## Registry and judge

Each check is Markdown with YAML frontmatter: identity, kind, severity, tiers,
include/exclude globs, command or review lens, origin and version. Deterministic
checks execute commands; model checks judge an inlined diff; method checks
declare work for a person or agent without claiming to have executed it.

Globs use Node's `matchesGlob` against repo-relative paths. `**` does not cross
dot-leading segments, so paths such as `.wst/**` need explicit patterns.

A model check's blocking authority comes from a valid calibration receipt or an
owner's `signed_block`. Calibration binds prompt, fixtures and model; runtime
version drift is reported. `check` marks signed authority as `BLOCK*`.
An unavailable judge or invalid response is an execution error, not a failed check.

The judge port is `LlmJudge`; `shell/judge.ts` selects the configured adapter.
The Claude adapter is hermetic: repo instructions, hooks and MCP must not steer
the repo's own reviewer. Everything to be judged is inlined.

```text
claude -p --output-format json --json-schema '<schema>' --append-system-prompt '<lens>' \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --settings '{"hooks":{},"outputStyle":"default"}' \
  --tools "" --model <haiku|sonnet|opus> [--max-budget-usd N]
```

The prompt goes on stdin. Keep `--append-system-prompt`: replacing the system
prompt corrupted structured output in measurement. Do not use `--bare`, which
requires API-key authentication. Envelopes carry usage and duration; native
schema validation is followed by application validation and retry policy.

## Compatibility

`gate` remains the existing push/CI surface. It can reuse receipts, and allows uncovered
changes without claiming checks passed. Its policy is whether a push may proceed;
readiness reports whether verification was established. This repo's hook and CI still use
`gate`.

`check` and `triage` are diagnostics. `status` inspects installation and adapter health,
not a diff. `wst` with no arguments prints the help.

`signal`, `retro`, `update`, `config` and the launcher are deleted (adr-0048, adr-0049).
Tag `v0.9.0` carries them. Their records stay in `.wst/memory/`.
