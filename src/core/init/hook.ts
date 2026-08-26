/**
 * The pre-push hook `init` writes. PURE.
 *
 * The README's central claim is that the exit code is the enforcement surface,
 * and `init` used to write everything BUT the hook that produces it. The script
 * existed only inside the Claude Code skill, so a repo bootstrapped any other
 * way had nothing to arm.
 *
 * Arming stays manual: `core.hooksPath` takes one value, and setting it here
 * would silently disarm husky.
 */

/** Git feeds one line per ref on stdin, so the range comes from there. */
export function renderPrePushHook(): string {
  return `#!/bin/sh
# Whetstone gate. Deterministic checks only: a hook that costs money and fifty
# seconds on every push gets bypassed with --no-verify, and a routed-around gate
# is worth less than no gate. The review lens belongs in CI.
ZERO="0000000000000000000000000000000000000000"
command -v wst >/dev/null 2>&1 || exit 0   # not installed here: never block on that

# git feeds one line per ref: <local ref> <local sha> <remote ref> <remote sha>
while read -r lref lsha _rref rsha; do
  [ "$lsha" = "$ZERO" ] && continue        # branch deletion, nothing to gate
  case "$lref" in refs/tags/*) continue;; esac   # a tag has no diff to gate

  if [ "$rsha" = "$ZERO" ]; then
    # New branch: the remote has no history for it. Gating against the all-zero
    # sha would diff the whole repository and time out on a branch's first push.
    base="$(git merge-base "$lsha" refs/remotes/origin/HEAD 2>/dev/null \\
         || git merge-base "$lsha" origin/main 2>/dev/null || echo "")"
    [ -z "$base" ] && exit 0
    range="$base..$lsha"
  else
    range="$rsha..$lsha"
  fi

  code=0
  wst gate --no-lens --range "$range" || code=$?
  if [ "$code" -ne 0 ]; then
    if [ "$code" -eq 2 ]; then
      echo "whetstone: a required check could not run, so this was NOT verified." >&2
    else
      echo "whetstone: a required check failed. Fix it, or push with --no-verify." >&2
    fi
    exit 1
  fi
done
exit 0
`;
}

/** Where git looks once `core.hooksPath` points at `.githooks`. */
export const PRE_PUSH_PATH = ".githooks/pre-push";
