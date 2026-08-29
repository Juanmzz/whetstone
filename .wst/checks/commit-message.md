---
id: commit-message
description: A commit names its kind in a conventional subject, and credits nobody who did not write it.
kind: deterministic
severity: block
tiers: [strict, light]
include:
  - "**"
  - "*"
  - ".*"
  - ".wst/**"
  - ".github/**"
  - ".githooks/**"
  - ".claude/**"
command: npm run check:commit-message
skippable: false
origin: []
version: 1
---

Two rules, both measured over this repo's 333 commits before being written.

**The subject is conventional.** `type(scope): description`, with a type from the
standard set. 332 of 333 already match, and 60 of the last 60, so this holds a rule
rather than introducing one. It exists because nothing held it: the one that does not
match got in the same way anything gets in.

**No commit credits a model.** `Co-Authored-By:` naming an assistant, and the
`Generated with` footer. Four commits carry one. The commit carries the author's name,
and a model is not a co-author of it.

**It matches attribution, not mention.** Nine lines in this history name the tool and
five of them are prose ABOUT it, in the commits that describe the plugin and the hook.
A pattern that cannot tell `Co-Authored-By: Claude` from "the Claude Code skill" makes
the subject undiscussable in the very messages that discuss it.

**What it deliberately does NOT judge**, and this is the measurement rather than a
preference. Subject length: the house rule is 72 and 10 of the last 60 commits are
longer. Whether a body exists: the house rule is one line and 23 of the last 60 have
prose bodies, 267 of 333 overall. Those two are worth deciding, and a check that
blocks 38% of what the repo actually does is a check that teaches `--no-verify`.

**Its `include` is a workaround.** A commit always has a message, so this should run on
every change, and the registry selects by changed PATH. There is no way to say
"always", so the globs are made broad enough to catch anything, including the
dot-leading segments a bare `**` will not cross. The first check here whose subject is
not a file; the registry has not caught up with it.

**It runs the script, not the binary.** `wst` on PATH here is a different checkout of
this same project, so a check that shelled out to it would gate this branch with another
branch's rules. The seeded copy names `wst check run commit-message`, which is correct
there and wrong here.

**It reads the range, not the tree**, so no receipt can stand in for it: the same
working tree over two different ranges is two different sets of messages.

## What it does not check

**The body.** A `why` is worth one paragraph and most commits owe none at all, but nothing
here counts its lines, and that is a decision rather than an omission.

No number survived being argued. This repo's median body over 333 commits is 10 lines and its
p90 is 22, so a ceiling low enough to change the habit fails most of the history it was
measured on. And the number would live in the binary, not in `.wst/`, so whatever this repo
chose would ship as a rule to every bootstrapped project without anyone there arguing it. The
remedy is the worse half: a commit is already written by the time the gate reads it, so the
only way to satisfy a body rule is to reword history to pass a style check, on a branch
somebody may already have pulled.

So the norm is written and not gated. The subject carries the change; the argument goes in the
pull request body (adr-0041) and the ADR. `tdd-discipline` v7 settled the same question the
same way when it dropped the requirement to quote red output in the body: a rule that costs
every commit several lines to satisfy one, and that no reader can verify, is guidance and not
a gate.
