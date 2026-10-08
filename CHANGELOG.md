# Changelog

## 0.10.0

- Cut: `signal`, `retro`, `update`, the memory substrate behind them, and the launcher
  (adr-0049). Bare `wst` prints the help. `git checkout v0.9.0` restores them.
- The product is three commands: `init`, `ready`, `status`. `gate` and `triage` remain
  as diagnostics and compatibility.
- `init` no longer asks the purpose and stack questions nothing read.
- The Claude Code Stop hook runs `wst ready` instead of `gate`: work committed before
  stopping, and untracked files, are now verified.
- The CLI still accepts the flags and hooks 0.9 printed and wrote.
- Placeholder: `ready` explains failures and INCOMPLETE.
- Compatibility: scripts calling `signal`, `retro` or `update` break; CI and the pre-push
  hook that call `gate` keep working.

## 0.9.0

- New `wst ready`: no arguments, resolves its own base and scope from local Git, runs
  the checks those paths need, and answers READY, NOT_READY, INCOMPLETE or NO_CHANGES.
- `init` writes only what readiness needs (configuration, triage rules, checks), drafts
  with the judge first, and offers to make checks runnable. Deleted `config`.
- A check that could not run, or crashed, is INCOMPLETE and exits 2, never a failed
  check; a gate that could not run tells the agent nothing was verified.
- Paths are read with `-z`, so odd filenames cannot escape a check.
- Requires Node 22.12 or newer; `commander`'s declared engine is now correct.
- Compatibility: `gate` keeps its behavior; `signal`, `retro` and `update` were placed
  on standby (removed in 0.10.0).
