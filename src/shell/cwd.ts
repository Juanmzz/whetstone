/**
 * Where we are, asked once and safely.
 *
 * `process.cwd()` throws. macOS refuses it when the terminal has lost permission to
 * the directory (`EPERM: uv_cwd`), and it throws `ENOENT` when the directory was
 * deleted under a running process, which a worktree being removed does routinely.
 *
 * It was a DEFAULT PARAMETER on every command, and a default is evaluated before the
 * function body, so nothing inside could catch it: the process died with an uncaught
 * throw, exited 1, and a crash that ran no checks became indistinguishable from a
 * check that failed.
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
 * The working directory, or null when nothing can say where we are.
 *
 * Null rather than a guess like `/` or the home directory: a command that verifies
 * the wrong tree and reports on it is worse than one that refuses and says why. The
 * caller turns null into an exit 2, never an exit 1.
 */
export function resolveCwd(source: CwdSource = { cwd: () => process.cwd(), env: process.env }): string | null {
  try {
    const here = usable(source.cwd());
    if (here !== null) return here;
  } catch {
    // Every way of not knowing lands the same: fall through to what the environment
    // still remembers. The reason is not actionable and the fallbacks are.
  }

  // PWD FIRST. It follows `cd`, so it still means "here". `CLAUDE_PROJECT_DIR` names
  // the SESSION root and is set on every command inside one, so preferring it verified
  // a different repository than the caller was standing in and reported READY over it.
  // Both reviewers found that independently; it is worse than the crash it replaced.
  const fallbacks = [
    { name: "PWD", value: usable(source.env["PWD"]) },
    { name: "CLAUDE_PROJECT_DIR", value: usable(source.env["CLAUDE_PROJECT_DIR"]) },
  ];

  for (const { name, value } of fallbacks) {
    if (value === null) continue;
    // ANNOUNCED. A fallback can name the wrong tree, and a wrong tree verified in
    // silence is the failure this whole class keeps producing.
    const warn = source.warn ?? ((m: string): void => void process.stderr.write(`${m}\n`));
    warn(`whetstone: could not read the working directory; using ${name} (${value}).`);
    return value;
  }

  return null;
}

/**
 * The working directory, or a readable failure. The default on every command.
 *
 * It throws rather than returning null so a command's signature stays `string`, and
 * the message is what a person needs: `cli.ts` turns any throw into exit 2, so this
 * can never again be read as a check having failed.
 */
export function requireCwd(source?: CwdSource): string {
  const here = source === undefined ? resolveCwd() : resolveCwd(source);
  if (here !== null) return here;
  throw new Error(
    "cannot read the working directory (the process was denied it, or it was deleted). " +
      "Nothing was verified. On macOS, grant your terminal access under Privacy & Security > " +
      "Files and Folders, or run from a directory that still exists.",
  );
}
