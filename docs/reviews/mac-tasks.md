# Two things to run on the Mac

Both need credentials this VPS does not have. Run them from the repo root, on `main`.

---

## Run 2 first. It is two minutes and five cents, and it validates a path that has
## never executed.

## 1. Re-measure the lens — the one that decides

```bash
git pull
npm ci && npm run build
npm run calibrate
```

**~15 minutes, ~$4.** 100 calls: 10 fixtures × 10 runs.

### Why this run means something and the last one did not

The bar asks for 100 clean runs. Two came back as infrastructure failures and neither
was retried, so at a 2% error rate the bar passed **13% of the time however good the
lens was**. The `failed` verdict of 2026-08-20 measured the network.

Transient failures now retry — three consecutive would be needed, which is 0.0008%.
The bar is reachable at 99.9%.

### How to read the result

```
judgment  N fixture(s) flipped     ← THIS is the lens. Anything above 0 is a real miss.
harness   N/100 runs returned no verdict   ← infrastructure. Should now be 0.
```

**If it passes**, `correctness` may declare `severity: block` and the tool has a
differentiator a linter cannot supply.

**If it fails with `harness 0/100`**, it is genuinely the lens, known for the first
time. That is a publishable answer too — it ships at `warn` and the README says so.

**If `harness` is still above 0**, the retry did not cover that failure mode. The
receipt now records WHICH error each one was, so `.wst/checks/correctness.calibration.json`
answers that without the console.

For the record, the two from 2026-08-20 were `error_max_structured_output_retries` and a
non-`ENOENT` `spawn` — both kinds the retry now covers. That is why the estimate is what
it is, and until this run it rested on a console log rather than on an artifact.

Do not edit a fixture to make it pass. The bar was recorded before the first run so it
could not be fitted to the result, and that is the only reason it means anything.

---

## 2. Run the Gemini adapter against the real CLI — once

It has never run against anything but the envelope you captured. The tests pin the
parsing; nothing has exercised the invocation.

```bash
# point the lens at gemini, one call, one fixture
sed -i '' 's/^kind: llm$/kind: llm\nagent: gemini/' .wst/checks/correctness.md
npm run calibrate -- --check correctness --filter known-good --runs 1

git checkout .wst/checks/correctness.md      # put it back either way
```

**One call.** Enough to prove or disprove the whole path.

### What would surprise me

`--skip-trust` is passed because the neutral directory a hermetic judge runs in can
never be a trusted workspace. `GEMINI_CLI_HOME` points at an empty temp dir so your
`~/.gemini/skills/` cannot reach the judge — that is the one your capture caught
announcing itself.

If it errors, the line starting `!` names the kind. `spawn` means the flags are wrong;
`invalid-output` means the response came back in a shape the parser did not expect,
and pasting the raw stdout is enough for me to fix it.

**No receipt is written.** A `--filter` run measures a subset and returns before
recording one (`scripts/calibrate.ts:304`), so the 2026-08-20 measurement is not at
risk. The guard was already there; an earlier version of this file said otherwise and
was wrong.
