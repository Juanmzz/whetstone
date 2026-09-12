/**
 * What makes verification actually run. PURE: the text of a hook and of a stanza.
 *
 * Deliberately NOT part of the plan. adr-0048 rules that `init` writes what selects
 * and runs a check and nothing else, and arming a gate is a different act from
 * installing one: it changes what happens on someone's machine. So this is offered
 * after the plan is written, declinable, and `status` reports which of it is live.
 */

import { DEFINITION_DIR } from "../paths.js";

/** Where the hook goes, and what `core.hooksPath` must name for git to find it. */
export const HOOKS_DIR = ".githooks";

/** The front door an agent reads. One of several names; this is the portable one. */
export const AGENTS_FILE = "AGENTS.md";

/** How a re-run recognises its own stanza without matching prose that mentions it. */
export const AGENTS_STANZA_MARKER = "<!-- whetstone:verification -->";

/**
 * The pre-push gate a target repo gets.
 *
 * It calls `gate`, not `ready`. adr-0021 rules that "nothing covers this" may not
 * block a push, and `ready` reports INCOMPLETE there (adr-0048), so a hook built on
 * it would refuse a documentation-only push: the exact pressure that teaches
 * `--no-verify`. Two questions, two answers, one engine.
 */
export function renderPrePushHook(): string {
  return `#!/usr/bin/env bash
# Whetstone pre-push gate. Written by \`wst init\`, and inert until armed with:
#   git config core.hooksPath ${HOOKS_DIR}
# \`wst status\` reports whether that is set, so an unarmed hook shows as drift
# rather than as silence.
#
# Deterministic checks only. A hook that costs a minute on every push gets
# bypassed, and a gate that is routed around is worth less than no gate.
set -euo pipefail

ZERO="0000000000000000000000000000000000000000"

# git feeds pre-push one line per ref: <local ref> <local sha> <remote ref> <remote sha>
while read -r local_ref local_sha _remote_ref remote_sha; do
  [ "\$local_sha" = "\$ZERO" ] && continue   # branch deletion, nothing to gate
  # A tag points at a commit already gated when its branch was pushed.
  case "\$local_ref" in refs/tags/*) continue;; esac

  if [ "\$remote_sha" = "\$ZERO" ]; then
    # New branch: gate from where it diverged. An all-zero sha would diff the whole
    # repository and time out on the first push of any branch.
    BASE="\$(git merge-base "\$local_sha" refs/remotes/origin/HEAD 2>/dev/null \\
         || git merge-base "\$local_sha" origin/main 2>/dev/null \\
         || git merge-base "\$local_sha" origin/master 2>/dev/null \\
         || echo "")"
    [ -z "\$BASE" ] && { echo "whetstone: no base to compare against, push allowed." >&2; exit 0; }
    RANGE="\$BASE..\$local_sha"
  else
    RANGE="\$remote_sha..\$local_sha"
  fi

  echo "whetstone: gating \$RANGE"
  # \`|| code=\$?\` keeps the real exit code. \`if ! cmd\` would negate it, and then
  # the could-not-run arm below is unreachable.
  code=0
  wst gate --no-lens --range "\$RANGE" || code=\$?
  if [ "\$code" -ne 0 ]; then
    echo "" >&2
    if [ "\$code" -eq 2 ]; then
      # Exit 2 is a check that could not RUN. That is the gate being broken, not the
      # change being bad, and the two must never share a message.
      echo "whetstone: a required check could not run, so this change was NOT verified." >&2
    else
      echo "whetstone: a required check failed. Fix it, or push with --no-verify if you" >&2
      echo "           genuinely mean to bypass the gate." >&2
    fi
    exit 1
  fi
done

exit 0
`;
}

/**
 * The stanza appended to the file an agent reads before it works.
 *
 * A request rather than an enforcement, and named as one: no hook exists in every
 * harness, so the portable half of "do not say done without checking" is asking.
 */
export function renderAgentsStanza(): string {
  return `${AGENTS_STANZA_MARKER}
## Verification

Run \`wst ready\` before reporting this work complete. It resolves what changed in
the worktree by itself and runs this project's checks over it; there is nothing to
pass it.

Read the exit code, and do not merge the two it separates:

- \`0\` verification completed. Any failed warning or omitted check is named in the
  output, so read it rather than the number alone.
- \`1\` a blocking check ran and failed. The work is not done.
- \`2\` a check could not run, or nothing verified the change. This is the gate being
  broken or the scope being empty, NOT a verdict on the work. Say so plainly instead
  of reporting it as a failure or as a pass.

The checks live in \`${DEFINITION_DIR}/checks/\`, one file each, and are edited there.
`;
}

/** Whether the stanza is already in a file. Null contents mean there is no file. */
export function agentsStanzaPresent(contents: string | null | undefined): boolean {
  return contents !== null && contents !== undefined && contents.includes(AGENTS_STANZA_MARKER);
}
