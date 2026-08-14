---
id: adr-refs
description: Every decision id cited in the repo resolves to an anchor in .wst/memory/decisions.md, and no link points into the directory that page replaced.
kind: deterministic
severity: block
tiers: [strict, light]
include:
  - "*.md"
  - "docs/**"
  - "plugin/**"
  - "scripts/**"
  - "src/**"
  - "test/**"
  - ".claude/**"
  - ".github/**"
  - ".githooks/**"
  - ".wst/**"
command: npm run check:adr-refs
origin: [adr-0017, adr-0019]
version: 2
---

Decision ids are references, not decoration. A check's `origin:` names them, comments
cite them to say why code is shaped the way it is, and prose points at them
everywhere — 238 citations across 191 tracked files at the time this landed.

Folding the nineteen per-file ADRs into one page (adr-0019) changed what a citation
resolves to: an anchor, not a filename. Both failures are silent — a citation of a
decision that has no anchor reads exactly like one that does, and a markdown link into
the old directory renders as a link and 404s.

**This replaces `adr-shape`,** which validated per-file frontmatter and sections. One
rule survives the fold: every entry carries a `status`, because that is how a decision
is amended (adr-0007, inherited by adr-0019) and it is what a retro flips. The rest is
addressability — anchors well-formed, unique and sequential, every cited id landing on
one.

**`include` spells out the dotted directories.** `node:path`'s `matchesGlob` will not
let `**` cross a dot-leading segment, so `.github/**`, `.githooks/**` and `.claude/**`
each need their own line — and without them the check went blind to
`.github/workflows/gate.yml`, which cites adr-0009. `test/adr-refs.test.ts` fails if a
directory holding a citation drops out of this list.

**What it deliberately does not check:** whether an entry states its rejected
alternative well. That is a reader's judgment and a retro's. Whether `adr-0011`
resolves is a fact.

**When it fails:** add the missing anchor, fix the citation, or repoint the link at
`.wst/memory/decisions.md#adr-NNNN`. It reports every problem in one run.

Deterministic checks may block freely (constitution non-negotiable 7). Every rule here
compares a string in a file to a heading the filesystem already holds.
