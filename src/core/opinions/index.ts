/**
 * What `init` may OFFER and never seeds unasked (adr-0025).
 *
 * An opinion is a rule no repo declares and that this one earned by getting it
 * wrong. It is written only when someone answers yes, and it arrives at `warn`:
 * it was earned here, not there, and a blocking rule nobody asked for is the
 * "pile of config from guesses" adr-0016 exists to prevent.
 */

export interface Opinion {
  readonly id: string;
  /** One line, in the interview's voice. */
  readonly title: string;
  /** What went wrong that made this a rule. The reason to say yes or no. */
  readonly friction: string;
  /** Signals or decisions in Whetstone's own record. Labels, not links to follow. */
  readonly origin: readonly string[];
  /** The subcommand the seeded check runs. Never a script the target repo lacks. */
  readonly command: string;
  readonly body: string;
  /**
   * Whether a receipt may stand in for running it. Literal `false` where the
   * answer depends on the range rather than on file contents.
   */
  readonly skippable: boolean;
}

export const OPINIONS: readonly Opinion[] = Object.freeze([
  {
    id: "comment-density",
    title: "Block a change whose added lines are more than a quarter comment",
    friction:
      "A rule stated twice, applied by hand once, and back two days later on a branch " +
      "written by the same person who applied it. Nothing held it.",
    origin: ["sig-4a2610fb"],
    command: "wst opinion comment-density",
    skippable: false,
    body:
      "Comments belong where the code cannot be made clear on its own. History, a " +
      "rejected alternative, and what a module used to do belong in the commit body or " +
      "in the decision record. A comment that recounts a change is stale the moment the " +
      "next one lands.\n\n" +
      "**It reads the diff, not the tree.** One branch at 33% moves a repo average by a " +
      "tenth of a point and passes, so the rule is not expressible over a whole checkout.\n\n" +
      "**The ceiling was measured, not chosen**, over thirty commits of the repo this came " +
      "from: 19, 20, 21, 22, 29, 30, 39, 39, 47. Twenty-five sits in the gap. Move it here, " +
      "where the next reader can see that you did.\n\n" +
      "**What it refuses to judge:** a change with fewer than fifteen added lines, and one " +
      "that removes at least as many comment lines as it adds in the files it also added to. " +
      "Without the second, a commit that CLEANS comments scores 100%.\n\n" +
      "**Seeded at `warn`.** It was earned somewhere else. Promote it once it has caught " +
      "something here.",
  },
]);

export function opinionById(id: string): Opinion | null {
  return OPINIONS.find((o) => o.id === id) ?? null;
}

/** The ids that exist, for validating an answer without loading the bodies. */
export const OPINION_IDS: readonly string[] = Object.freeze(OPINIONS.map((o) => o.id));
