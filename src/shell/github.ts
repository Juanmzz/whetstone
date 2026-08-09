/**
 * The GitHub adapter. THIN by policy, like `git.ts`: it runs `gh` and returns data.
 * Every decision — what is red, what to say, whether to post at all — is made in
 * `core/annotate/`, where the tests can reach it.
 *
 * ## Why `gh` and not an HTTP client
 *
 * No new dependency (`package.json` is shared), and `gh` already holds the user's
 * auth. `gh api` resolves `{owner}` and `{repo}` from the working directory, so this
 * adapter never has to parse a remote URL.
 *
 * ## The endpoints, verified against the OpenAPI description
 *
 * - `POST /repos/{owner}/{repo}/pulls/{n}/reviews` — body takes `event`
 *   (`APPROVE` | `REQUEST_CHANGES` | `COMMENT`), `body` (**required** for the latter
 *   two), and `comments[]` of `{path, body, line?, side?, start_line?, start_side?}`.
 *   `position` is closing down and is not used.
 * - `GET  /repos/{owner}/{repo}/pulls/{n}/comments` — existing review comments; this
 *   is the input to `pruneAlreadyPosted`.
 * - `GET  /repos/{owner}/{repo}/pulls/{n}/reviews` — existing reviews; the input to
 *   `shouldPostReview`.
 *
 * ## Idempotency is NOT implemented here
 *
 * GitHub has no upsert for review comments, so "running twice must not duplicate" is
 * a decision, and decisions do not live in `src/shell/`. This adapter only *reads*
 * what is already posted; `core/annotate/body.ts` decides what is new. That is what
 * makes the guarantee a unit test rather than something discovered on a real PR.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PostedComment, ReviewComment } from "../core/annotate/body.js";

const run = promisify(execFile);

const MAX_BUFFER = 64 * 1024 * 1024;

export interface PrRef {
  readonly number: number;
  readonly url: string;
  /** Head commit of the PR. Anchoring a comment to a stale sha silently misplaces it. */
  readonly headSha: string;
  readonly body: string;
}

export interface CreatePrOptions {
  readonly title: string;
  readonly body: string;
  readonly head: string;
  readonly base?: string;
  readonly draft?: boolean;
}

export interface ReviewRequest {
  readonly event: "REQUEST_CHANGES" | "COMMENT" | "APPROVE";
  readonly body: string;
  readonly comments: readonly ReviewComment[];
  /** Defaults to the PR's most recent commit when omitted. */
  readonly commitId?: string;
}

export interface GithubPort {
  available(): Promise<boolean>;
  /** The PR for `branch`, or null when there is none. */
  findPr(branch: string): Promise<PrRef | null>;
  createPr(options: CreatePrOptions): Promise<PrRef>;
  setPrBody(pr: number, body: string): Promise<void>;
  listReviewComments(pr: number): Promise<PostedComment[]>;
  listReviews(pr: number): Promise<PostedComment[]>;
  postReview(pr: number, review: ReviewRequest): Promise<void>;
}

/** Run `gh`, optionally writing `stdin`. Rejects on non-zero exit, like `execFile`. */
async function gh(args: string[], cwd: string, stdin?: string): Promise<string> {
  const child = run("gh", args, { cwd, maxBuffer: MAX_BUFFER });
  if (stdin !== undefined) child.child.stdin?.end(stdin);
  const { stdout } = await child;
  return stdout;
}

/**
 * `gh api --paginate --slurp` wraps each PAGE in an outer array. Flattening here is
 * the one shape decision this file makes, and it is mechanical rather than a policy.
 */
function flattenPages(raw: string): unknown[] {
  const parsed: unknown = JSON.parse(raw === "" ? "[]" : raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((page) => (Array.isArray(page) ? (page as unknown[]) : [page]));
}

function bodiesOf(items: readonly unknown[]): PostedComment[] {
  return items.flatMap((item) => {
    const body = (item as Record<string, unknown>)["body"];
    return typeof body === "string" ? [{ body }] : [];
  });
}

/**
 * The wire shape for one comment. `fingerprint` is a Whetstone concept and is
 * stripped: it already travels inside `body` as an HTML comment, and sending an
 * unknown key risks a 422 on an endpoint that has been tightening for years.
 */
function wireComment(comment: ReviewComment): Record<string, unknown> {
  return {
    path: comment.path,
    body: comment.body,
    ...(comment.line !== undefined ? { line: comment.line } : {}),
    ...(comment.side !== undefined ? { side: comment.side } : {}),
    ...(comment.subject_type !== undefined ? { subject_type: comment.subject_type } : {}),
  };
}

export function createGithubAdapter(cwd: string = process.cwd()): GithubPort {
  return {
    async available() {
      try {
        await run("gh", ["auth", "status"], { cwd, timeout: 15_000 });
        return true;
      } catch {
        return false;
      }
    },

    async findPr(branch: string) {
      let raw: string;
      try {
        // `gh pr view` exits non-zero when the branch has no PR — that is a fact,
        // not an error, so it is translated rather than propagated.
        raw = await gh(
          ["pr", "view", branch, "--json", "number,url,headRefOid,body"],
          cwd,
        );
      } catch {
        return null;
      }
      const parsed = JSON.parse(raw) as {
        number: number;
        url: string;
        headRefOid: string;
        body: string;
      };
      return {
        number: parsed.number,
        url: parsed.url,
        headSha: parsed.headRefOid,
        body: parsed.body ?? "",
      };
    },

    async createPr(options) {
      const args = [
        "pr",
        "create",
        "--title",
        options.title,
        "--body-file",
        "-", // the body contains newlines and markdown; argv is the wrong channel
        "--head",
        options.head,
      ];
      if (options.base !== undefined) args.push("--base", options.base);
      if (options.draft === true) args.push("--draft");

      await gh(args, cwd, options.body);

      const created = await this.findPr(options.head);
      if (created === null) {
        throw new Error(`created a PR for ${options.head} but could not read it back`);
      }
      return created;
    },

    async setPrBody(pr, body) {
      await gh(["pr", "edit", String(pr), "--body-file", "-"], cwd, body);
    },

    async listReviewComments(pr) {
      const raw = await gh(
        ["api", `repos/{owner}/{repo}/pulls/${String(pr)}/comments?per_page=100`, "--paginate", "--slurp"],
        cwd,
      );
      return bodiesOf(flattenPages(raw));
    },

    async listReviews(pr) {
      const raw = await gh(
        ["api", `repos/{owner}/{repo}/pulls/${String(pr)}/reviews?per_page=100`, "--paginate", "--slurp"],
        cwd,
      );
      return bodiesOf(flattenPages(raw));
    },

    async postReview(pr, review) {
      const payload = {
        event: review.event,
        body: review.body,
        ...(review.commitId !== undefined ? { commit_id: review.commitId } : {}),
        ...(review.comments.length > 0 ? { comments: review.comments.map(wireComment) } : {}),
      };
      await gh(
        [
          "api",
          `repos/{owner}/{repo}/pulls/${String(pr)}/reviews`,
          "--method",
          "POST",
          "--input",
          "-",
        ],
        cwd,
        JSON.stringify(payload),
      );
    },
  };
}
