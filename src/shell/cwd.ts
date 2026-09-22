/**
 * Where we are, asked once and safely.
 *
 * `process.cwd()` throws: macOS refuses it after the terminal loses permission
 * (`EPERM: uv_cwd`), and it is `ENOENT` for a directory deleted under a running
 * process. It was a DEFAULT PARAMETER on every command, and a default is evaluated
 * before the function body, so no `try` inside could reach it.
 */

export interface CwdSource {
  readonly cwd: () => string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Where a used fallback is announced. Defaults to stderr. */
  readonly warn?: (message: string) => void;
}

const usable = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * The working directory, or null when nothing can say where we are. Null rather
 * than a guess: verifying the wrong tree is worse than refusing and saying why.
 */
export function resolveCwd(source: CwdSource = { cwd: () => process.cwd(), env: process.env }): string | null {
  try {
    const here = usable(source.cwd());
    if (here !== null) return here;
  } catch {
    // The reason is never actionable; the fallbacks are.
  }

  // PWD FIRST: it follows `cd`, so it still means "here". `CLAUDE_PROJECT_DIR` names
  // the SESSION root, so preferring it verified a repository the caller was not
  // standing in and reported READY over it.
  const fallbacks = [
    { name: "PWD", value: usable(source.env["PWD"]) },
    { name: "CLAUDE_PROJECT_DIR", value: usable(source.env["CLAUDE_PROJECT_DIR"]) },
  ];

  for (const { name, value } of fallbacks) {
    if (value === null) continue;
    // Announced, because a fallback can name the wrong tree.
    const warn = source.warn ?? ((m: string): void => void process.stderr.write(`${m}\n`));
    warn(`whetstone: could not read the working directory; using ${name} (${value}).`);
    return value;
  }

  return null;
}

/**
 * The working directory, or a readable failure. The default on every command.
 * Throws rather than returning null, so a command's signature stays `string`.
 */
/** How `cli.ts` tells this apart from a bug. Both exit 2; only a bug gets a stack. */
export const CWD_FAILURE = "cannot read the working directory";

export function requireCwd(source?: CwdSource): string {
  const here = source === undefined ? resolveCwd() : resolveCwd(source);
  if (here !== null) return here;
  throw new Error(
    `${CWD_FAILURE} (the process was denied it, or it was deleted). ` +
      "Nothing was verified. On macOS, grant your terminal access under Privacy & Security > " +
      "Files and Folders, or run from a directory that still exists.",
  );
}
