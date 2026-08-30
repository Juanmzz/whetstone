---
description: Turn something the user says went wrong into a concrete proposal, and record it as a signal in their own words. Use when the user says a change was not done the way they expected, that a rule was missed, or that something keeps happening; and after a gate blocks for a reason that looks wrong.
---

# When the user says it did not go the way they expected

The gate catches what somebody already wrote a check for. Everything else arrives as a
sentence in the middle of a session: *this is not how I wanted it done*. That sentence is
the only input this loop has that nothing else produces, and it is lost unless somebody
turns it into a record while it is still true.

Your job here is two things, in this order: **propose something concrete**, and **record
what they said, in their words**.

## The line you do not cross

> A machine writes signals about **facts it observed**. A human signs **anything that
> changes a rule**.

You may not record that you felt friction. `wst gate` writes signals about its own blocks
because a block is a fact with a timestamp. "This seems awkward" is not, and a log full of
it poisons every retro that reads it afterwards.

So: you never run `wst signal` on your own account, and you never run it with
`--confirmed` until the user has seen the exact words you are about to store.

## 1. Say what you would change

Before anything is recorded, answer the sentence. Name ONE of these, and be specific:

- **a rule** in `.wst/skills/<name>.md` that should say something it does not
- **a check** in `.wst/checks/` that would have caught this, with what it would run
- **a hook**, where the moment of the edit is when it needs saying
- **a triage rule**, where the discipline was wrong for the path

Read `.wst/triage-rules.md` and the relevant skill before proposing, so the proposal is an
amendment to what is there and not a duplicate of it. A second copy of a rule that already
exists is the failure `[L12]` names.

If nothing concrete comes to mind, say so plainly. "I do not know what would have caught
this" is a useful answer and a reason to record the signal anyway.

## 2. Draft the record, and show it

```bash
wst signal <kebab-case-type> "<what happened, reconstructably>" \
  --quote "<the user's own words, verbatim>" \
  --rule skills/<name>.md
```

The type and the detail are positional. There are no `--type` or `--detail` flags.

Without `--confirmed` this writes nothing. It prints the line it would append. That is the
draft; show it to the user.

Three rules the command enforces, and you should get right before it has to:

- **The detail is required and may not be empty.** A signal nobody can reconstruct the
  event from is not evidence, and the log is append-only, so noise stays forever.
- **`--quote` is the user's words, verbatim.** Not your restatement of them. The quote is
  the provenance: it is checkable against the transcript and `attested` is not.
- **The type is kebab-case.** The retro clusters on it verbatim, so `triage-miss` and
  `Triage Miss` are two clusters of one.

## 3. Ask, then write

Show the draft and ask. If they say yes, re-run the same command with `--confirmed`. It
records as `source: human-quoted`, which is neither `human` (they did not type it) nor
`cli` (they did approve it). Composing a record and approving one are different acts, and
that difference is the whole job of the `source` field.

If they say no, or change the words, redraft. Do not argue the record into existence.

## What happens next, so you can say it

Nothing applies automatically. `wst retro` clusters signals and proposes rule changes; it
never writes one. The user decides. Telling them "this will change the rule" is wrong;
"this is now on the pile the next retro reads" is right.
