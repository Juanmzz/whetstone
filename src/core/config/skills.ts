/**
 * What a skill file says about itself, in one line. PURE.
 *
 * The config screen listed eight filenames and nothing else, so choosing which
 * to switch off meant opening each one. Nothing in the frontmatter answers it:
 * these files carry `id`, `version` and `status`, and the description is the
 * first sentence of the prose.
 */

/** Everything after the frontmatter, or the whole text when there is none. */
function bodyOf(text: string): string {
  const parts = text.split(/^---$/m);
  return parts.length >= 3 ? parts.slice(2).join("---") : text;
}

/** Markdown a terminal renders as punctuation rather than as emphasis. */
function plain(line: string): string {
  return line
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function summaryOf(text: string): string {
  const body = bodyOf(text);
  const lines = body.split("\n");

  const heading = lines.find((l) => l.startsWith("# "))?.slice(2).trim() ?? "";

  // The paragraph under the heading, joined: it is wrapped in the file, and a
  // sentence cut at the author's line break is not a sentence.
  const prose: string[] = [];
  let seenHeading = false;
  for (const line of lines) {
    if (line.startsWith("#")) {
      if (seenHeading && prose.length > 0) break;
      seenHeading = true;
      continue;
    }
    if (line.trim() === "") {
      if (prose.length > 0) break;
      continue;
    }
    prose.push(line.trim());
  }

  const paragraph = plain(prose.join(" "));
  if (paragraph === "") return plain(heading);

  // First sentence only, and a colon does not end one: `voice` opens "How the
  // agent engages the human in conversation: the working relationship, not the
  // artifacts", where the half before the colon says nothing.
  const stop = /\.(\s|$)/.exec(paragraph);
  return stop === null ? paragraph : paragraph.slice(0, stop.index + 1);
}
