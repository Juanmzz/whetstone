# Whetstone

**Self-sharpening standards for coding agents.**

Whetstone captures what *correct* means in your repo as plain files in git, then
enforces it with a deterministic engine that calls a model only where judgment is
irreducible. The exit code is the enforcement: it runs at push and in CI, so it does
not depend on an agent choosing to cooperate.

## Install

```bash
npm install -g @juanmzz/whetstone

cd your-repo
wst init      # interview the repo, write .wst/
wst status    # what is armed, and what is not
```

Node 22 or newer. `init` shows you the plan before it writes anything, and
`--dry-run` shows it without writing at all.

## The loop

```
wst init     interview the project, generate .wst/
wst gate     select the checks that apply, skip what receipts prove unchanged, pass or block
wst signal   record the friction a run hit
wst retro    cluster the signals, propose rule changes, never apply them
```

Everything lands as files you can read, diff and revert. Delete `.wst/` and the tool
is gone; nothing else knows you installed it.

## Four outcomes, not two

| | |
|---|---|
| `0` **passed** | every check that applied ran, and none failed |
| `0` **uncovered** | no check matched these paths, and it says so rather than implying a pass |
| `1` **blocked** | a check ran and failed |
| `2` **incomplete** | a check that could have blocked never ran, so the gate is broken, not your change |

Splitting *failed* from *could not run* is the difference between a gate you trust and
one you learn to route around.

## The judgment check

One check asks a model whether a diff introduces a correctness bug. It earned the right to
block by measurement: 100 correct verdicts out of 100, unanimous on ten fixtures, recorded in
a receipt that binds the prompt, the fixtures, the model and the runtime. Change any one and
the authority lapses.

**It blocks nowhere today.** The pre-push hook skips it because a gate that costs fifty
seconds and real money every push is one people bypass; CI skips it because a runner has no
interactive session. So it runs when you run it: `wst gate`, without `--no-lens`. The decision
that promoted it carries `· unbuilt` for that reason.

## Documentation

- [Architecture](./docs/architecture.md): what is true now, in the present tense
- [Design](./docs/design.md): where to read about each part, and a check file field by field
- [Vision](./VISION.md): what this is, and what it deliberately is not

An `llm` check needs the CLI it names, `claude` or `agy`. Nothing else is bundled.

## Contributing

Read [VISION.md](./VISION.md) first, especially *What Whetstone is NOT*. One concern
per pull request.

```bash
npm install && npm test
```

## License

MIT
