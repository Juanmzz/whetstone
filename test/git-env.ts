/**
 * Cutting the test process loose from an inherited git environment.
 *
 * FOUND BY PUSHING, not by reasoning. The pre-push hook runs `wst gate`, whose
 * `test` check runs `npm test` — and git exports `GIT_DIR`, `GIT_INDEX_FILE` and
 * friends to everything a hook spawns. Every temp repository these tests build
 * then inherits them, so `git init` in `/tmp/wst-xxx` produces a directory that
 * reports the WHETSTONE repo as its root, `git commit` writes into the pushing
 * repo's index, and 32 tests that pass from a shell fail from a hook.
 *
 * A suite that only passes when it is run by hand is worse than one that fails:
 * the gate is what runs it, and that is the run whose answer is trusted.
 *
 * The whole `GIT_*` block goes, not a chosen few. Git has a dozen of these and
 * adds more; an allowlist here would be a guard that only catches the variables
 * someone already thought of. `git` falls back to its compiled defaults for every
 * one of them, which is exactly the state a test wants.
 *
 * Called at module scope, once per file: vitest gives each test file its own
 * process, so this cannot reach another file's environment.
 *
 * NOT a statement about `src/shell/git.ts`, which still inherits whatever its
 * caller was given. Whether an adapter pointed at one directory should be able to
 * read another repository because a hook set a variable is a real question, and it
 * belongs in an issue rather than in a test helper.
 */
export function isolateFromInheritedGit(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_")) delete process.env[key];
  }
}
