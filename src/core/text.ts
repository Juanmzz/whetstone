/**
 * Fitting a sentence to a terminal. PURE.
 *
 * Wrapped, never cut. Three reports were cutting a list at eighty characters,
 * and the half that fell off was the half that named what was missing.
 */

/** Words, at most `width` characters to a line. A word longer than that keeps its own line. */
export function wrap(text: string, width: number): readonly string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((w) => w !== "")) {
    if (line === "") line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** The same, already indented, for a caller that is building a page of lines. */
export function wrapped(text: string, width: number, indent: string): readonly string[] {
  return wrap(text, width - indent.length).map((line) => indent + line);
}
