/**
 * Reading a calibration run by DEFECT SHAPE, not only by difficulty. PURE.
 *
 * The v4 run scored 9/10 fixtures clean and printed
 * `easy 2/2 · medium 2/2 · hard 5/6`. True, and it hides the finding: every one
 * of the misses was the same KIND of mistake — the lens inventing a race in
 * correct concurrent code. Reading that off the report meant noticing that the
 * one failing fixture was called `race-good`.
 *
 * Slicing the evaluation set and reporting per slice is standard evaluation
 * practice (Chip Huyen, *AI Engineering*, ch. 4). Difficulty is a slice about how
 * hard we expected a fixture to be; defect shape is a slice about what the lens
 * is actually for, and it is the one that tells you whether a failure is one
 * fixture's phrasing or a systematic blind spot.
 *
 * The two directions are kept apart on purpose. A lens that misses planted bugs
 * is under-sensitive; a lens that invents them in correct code is over-sensitive,
 * and only the second teaches people to route around the gate. Collapsing them
 * into one number per slice would hide exactly the asymmetry that matters.
 */

/**
 * The defect a fixture is about, from its filename.
 *
 * `race-good.diff` and `race-bad.diff` are one pair testing one shape, so both
 * slice to `race`. Derived rather than declared: the pairing is already a naming
 * convention the fixture directory enforces by existing, and a `defect:` field in
 * the manifest would be a second place to state it — which is how the two get to
 * disagree.
 *
 * A file that does not follow the convention slices to its own stem, so it forms
 * a slice of one rather than vanishing into someone else's.
 */
export function defectOf(fixtureFile: string): string {
  const stem = (fixtureFile.split("/").pop() ?? fixtureFile).replace(/\.diff$/, "");
  const paired = /^(.*)-(?:good|bad)$/.exec(stem);
  return paired?.[1] ?? stem;
}

export interface SliceOutcome {
  /** The fixture's filename, e.g. `race-good.diff`. */
  readonly file: string;
  /** What the fixture asserts the correct verdict is. */
  readonly expected: "pass" | "fail";
  /** Whether the lens was unanimously right across every run. */
  readonly clean: boolean;
}

export interface Slice {
  readonly defect: string;
  readonly clean: number;
  readonly total: number;
  /**
   * Clean fixtures whose correct answer is `pass`, over how many there are.
   *
   * Broken out because a miss here is a FALSE POSITIVE — the lens calling correct
   * code broken. That is the failure this calibration bar exists to catch: a
   * missed bug costs a bug, and a cried wolf costs the gate.
   */
  readonly cleanGood: number;
  readonly totalGood: number;
}

/** Slices in the order a reader wants them: worst first, then alphabetical. */
export function slicesOf(outcomes: readonly SliceOutcome[]): readonly Slice[] {
  const by = new Map<string, { clean: number; total: number; cleanGood: number; totalGood: number }>();

  for (const o of outcomes) {
    const defect = defectOf(o.file);
    const slice = by.get(defect) ?? { clean: 0, total: 0, cleanGood: 0, totalGood: 0 };
    slice.total += 1;
    if (o.clean) slice.clean += 1;
    if (o.expected === "pass") {
      slice.totalGood += 1;
      if (o.clean) slice.cleanGood += 1;
    }
    by.set(defect, slice);
  }

  return [...by.entries()]
    .map(([defect, s]) => ({ defect, ...s }))
    .sort((a, b) => a.clean / a.total - b.clean / b.total || a.defect.localeCompare(b.defect));
}

/**
 * The slice lines, worst first.
 *
 * A slice that is clean says so in one column. A slice that is not names the
 * direction, because "1/2" alone does not say whether the lens missed a bug or
 * invented one, and the two lead to opposite fixes.
 */
export function renderSlices(slices: readonly Slice[]): string[] {
  const width = Math.max(0, ...slices.map((s) => s.defect.length));

  return slices.map((s) => {
    const head = `  ${s.defect.padEnd(width)}  ${s.clean}/${s.total}`;
    if (s.clean === s.total) return head;

    const missedGood = s.totalGood - s.cleanGood;
    const note =
      missedGood > 0
        ? `called correct code broken (${missedGood} of ${s.totalGood} \`-good\`)`
        : "missed a planted defect";
    return `${head}  ← ${note}`;
  });
}
