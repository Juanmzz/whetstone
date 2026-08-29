/**
 * Whether a pull request body can be read. PURE.
 *
 * Two rules were in force at once and they contradicted each other. Thirty-one
 * merged pull requests carry a one-line body; nine carry the template, and those
 * run 26 to 59 lines. This settles it in the template's favour and puts a ceiling
 * on it, because the reason for a body is that somebody reads it.
 */

/** The template's own headings, in its own order. Nothing else is a section. */
export const SECTIONS: readonly string[] = Object.freeze([
  "What changed",
  "What it rules out",
  "Evidence",
  "Verification",
  "Not verified",
]);

/**
 * Measured over the forty merged bodies, not chosen.
 *
 * The nine that use the template run 26, 27, 29, 30, 34, 35, 40, 47 and 59 lines.
 * The five sections written tightly are about 25. Forty leaves room for a real
 * Evidence block and cuts the two nobody reads through.
 */
export const MAX_LINES = 40;

export interface PrBodyRead {
  /** What is wrong, in the order a writer would fix it. Empty means it reads. */
  readonly problems: readonly string[];
  /** Lines that count against the ceiling. Comments and trailing blanks do not. */
  readonly lines: number;
}

const HEADING = /^#{1,6}\s+(.+?)\s*$/;

/** The template's instructions to the writer, which are not the writer's prose. */
function withoutComments(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "");
}

interface Section {
  readonly title: string;
  readonly content: string;
}

function sectionsIn(lines: readonly string[]): Section[] {
  const found: { title: string; body: string[] }[] = [];
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading !== null) found.push({ title: heading[1] ?? "", body: [] });
    else found.at(-1)?.body.push(line);
  }
  return found.map((s) => ({ title: s.title, content: s.body.join("\n").trim() }));
}

export function readPrBody(raw: string): PrBodyRead {
  const text = withoutComments(raw);
  const lines = text.split("\n");
  // Trailing blanks are what an editor leaves behind, not what anyone wrote.
  while (lines.length > 0 && (lines.at(-1) ?? "").trim() === "") lines.pop();

  if (lines.every((l) => l.trim() === "")) {
    return { problems: ["the body is empty. Say what changed, in a sentence or two."], lines: 0 };
  }

  const problems: string[] = [];
  const sections = sectionsIn(lines);
  const titles = sections.map((s) => s.title);

  if (!titles.includes("What changed")) {
    problems.push(
      "no `## What changed` section. It is the one every change has, so it is the one that is required.",
    );
  }

  for (const section of sections) {
    if (!SECTIONS.includes(section.title)) {
      problems.push(
        `\`${section.title}\` is not a section of the template. It has: ${SECTIONS.join(", ")}.`,
      );
      continue;
    }
    // The template says it in its own comment: an empty heading reads as a claim
    // that there was nothing to weigh. Deleting it says less and is true.
    if (section.content === "") {
      problems.push(`\`${section.title}\` is empty. Write it or delete the heading.`);
    }
  }

  if (lines.length > MAX_LINES) {
    problems.push(
      `${String(lines.length)} lines, over the ${String(MAX_LINES)}-line ceiling. ` +
        `A body nobody reads through is a body that did not get written.`,
    );
  }

  return { problems, lines: lines.length };
}
