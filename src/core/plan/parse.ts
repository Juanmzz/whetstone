/**
 * Reading a plan. PURE — the shell fetches the text, this turns it into a
 * declaration.
 *
 * **`wst plan` reads a plan; it does not write one** (adr-0013). So there is no
 * inference here — no guessing paths from a task description, no model. A path is in
 * the plan because somebody wrote it down.
 *
 * The format is markdown with YAML frontmatter, which is what every other
 * human-written artifact in this repo already uses (ADRs, check files, the skills).
 * `paths:` is the machine-readable half; the body is prose for the human, and the
 * engine never reads it.
 *
 * FAILS CLOSED, like `diff/parse.ts` and for the same reason turned around. There, a
 * dropped line leaves a file ungated. Here, a path this parser accepts but the glob
 * engine can never match is worse than a rejection: the tier still gets computed, the
 * report still prints, and the answer is confidently wrong. Anything that would
 * quietly degrade the prediction is therefore an error, not a warning.
 */

import { parse as parseYaml } from "yaml";

/** Markdown frontmatter: a `---` block, and only at the very start of the file. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export class PlanParseError extends Error {
  constructor(source: string, why: string) {
    // The source leads, because a plan arrives from a file OR from stdin and the
    // reader has to be able to tell which one they are being told about.
    super(`${source}: ${why}`);
    this.name = "PlanParseError";
  }
}

export interface DeclaredPlan {
  /**
   * The paths the plan expects to touch, in declaration order, de-duplicated.
   *
   * A PREDICTION, and ADR-0013 accepts that openly: "a plan that declares its own
   * paths can be wrong or incomplete". The ground truth exists at the other end —
   * `wst gate` classifies the real diff — so the cost of a wrong declaration is a
   * stale prediction, not a change that escaped.
   */
  readonly paths: readonly string[];
  /** What the plan means to do. Echoed, never interpreted. `null` when unstated. */
  readonly intent: string | null;
  /** Everything after the frontmatter. For the human; the engine ignores it. */
  readonly body: string;
}

/**
 * A declared path the glob engine can actually match.
 *
 * `matchesGlob` compares against repo-relative paths, so an absolute path or one
 * climbing out with `..` matches no rule in `triage.yaml` and lands on the `light`
 * fallback — a wrong tier, reported with the same confidence as a right one. Since
 * the fallback exists precisely so an UNRECOGNISED path is not called trivial, a
 * path that is unrecognisable by construction has to be rejected instead.
 */
function normalisePath(value: unknown, index: number, source: string): string {
  if (typeof value !== "string") {
    throw new PlanParseError(source, `\`paths[${index}]\` is ${typeof value}, expected a string`);
  }

  const path = value.trim().replace(/^\.\/+/, "");
  if (path === "") {
    throw new PlanParseError(source, `\`paths[${index}]\` is empty`);
  }
  if (path.startsWith("/")) {
    throw new PlanParseError(
      source,
      `\`paths[${index}]\` is absolute (${path}) — declare paths relative to the repo root, ` +
        `which is what the triage globs are matched against`,
    );
  }
  if (path.split("/").includes("..")) {
    throw new PlanParseError(
      source,
      `\`paths[${index}]\` climbs out of the repo (${path}) — no triage rule can match it, ` +
        `so it would be reported at the fallback tier rather than rejected`,
    );
  }
  return path;
}

function readPaths(raw: unknown, source: string): string[] {
  if (raw === undefined || raw === null) {
    throw new PlanParseError(
      source,
      "declares no `paths` — the declared paths are the input, and there is nothing to classify without them",
    );
  }
  if (typeof raw === "string") {
    // A one-character YAML mistake with a silent failure mode: iterating a string
    // yields characters, so `paths: src/core/x.ts` would classify fourteen
    // single-letter paths, match no rule, and confidently report `light`.
    throw new PlanParseError(source, "has `paths` as a string — it must be a list, one path per entry");
  }
  if (!Array.isArray(raw)) {
    throw new PlanParseError(source, `has \`paths\` as ${typeof raw}, expected a list`);
  }
  if (raw.length === 0) {
    throw new PlanParseError(
      source,
      "has a `paths` list that is empty — an empty plan would be reported as the empty-diff tier, " +
        "which is an answer about a plan nobody made",
    );
  }

  // De-duplicated rather than rejected: a repeated path changes no tier and no
  // coverage answer, it only inflates the "N of M files" count in the reason.
  return [...new Set(raw.map((value, index) => normalisePath(value, index, source)))];
}

export function parsePlan(text: string, source: string): DeclaredPlan {
  const match = FRONTMATTER.exec(text);
  if (match === null) {
    throw new PlanParseError(
      source,
      "has no YAML frontmatter — a plan declares the paths it expects to touch in a leading `---` block",
    );
  }

  const [, yamlText = "", body = ""] = match;

  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (cause) {
    throw new PlanParseError(source, `frontmatter is not valid YAML — ${(cause as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PlanParseError(source, "has frontmatter that is not a mapping");
  }
  const fm = raw as Record<string, unknown>;

  const intent = fm["intent"];
  if (intent !== undefined && intent !== null && typeof intent !== "string") {
    // Not coerced. Somebody wrote something in this field, and printing
    // `[object Object]` back at them is how a plan gets signed against an intent
    // nobody read.
    throw new PlanParseError(source, `has \`intent\` as ${typeof intent}, expected a string`);
  }

  return {
    paths: readPaths(fm["paths"], source),
    intent: typeof intent === "string" && intent.trim() !== "" ? intent.trim() : null,
    body: body.trim(),
  };
}
