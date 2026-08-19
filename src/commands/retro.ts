/**
 * `wst retro` — the self-sharpening loop. Composition root.
 *
 *   cursor -> new signals -> cluster (ENGINE) -> recommend (LLM) -> anti-poisoning
 *   gate (ENGINE) -> propose to a human (NEVER applied automatically)
 *
 * The gate in the middle is the point. The recommendation is agent-generated, so a
 * human gate alone is not enough: a plausible proposal citing a signal that never
 * happened is exactly what a tired reviewer approves. The machine checks its own
 * evidence first, and a proposal that fails never reaches the human.
 *
 * This command NEVER writes to a skill, a hook, or an ADR. It writes a proposal file.
 * Applying it is a human act — constitution non-negotiable 3.
 */

import { retroEnvelope } from "../core/retro/machine.js";
import { join } from "node:path";
import { z } from "zod";
import { clusterSignals, signalsSince, type Cluster } from "../core/retro/cluster.js";
import {
  renderProposal,
  validateRecommendation,
  type Recommendation,
} from "../core/retro/propose.js";
import { createGitAdapter } from "../shell/git.js";
import { resolveJudge } from "../shell/judge.js";
import { appendRetroLogStub, countRetros, readCursor, readSignals, writeProposals } from "../shell/retro.js";
import { resolveDefinitionRoot } from "../shell/sdd.js";
import { DEFINITION_DIR } from "../core/paths.js";
import { readdir, readFile } from "node:fs/promises";

export interface RetroOptions {
  /** Cluster and print, but make no LLM calls and write nothing. */
  readonly dryRun?: boolean;
  readonly model?: "haiku" | "sonnet" | "opus";
  /** The proposals as data, for the agent that presents them to a human. */
  readonly json?: boolean;
}

const RecommendationSchema = z.object({
  kind: z.enum(["amend", "graduate-to-hook", "command", "curate", "generate", "flip-adr"]),
  target: z.string(),
  summary: z.string(),
  rationale: z.string(),
  citedSignals: z.array(z.string()),
});

const LENS = [
  "You are the retro engine of Whetstone, proposing ONE change that would prevent a",
  "cluster of recorded friction from recurring.",
  "",
  "Prefer the SMALLEST apparatus that fixes it: a rule beats a hook beats a command",
  "beats a whole new skill. Prefer curating a proven solution over generating a new one.",
  "",
  `\`target\` MUST be a path under ${DEFINITION_DIR}/ — a skill, a hook, or an ADR. You may NEVER`,
  `target ${DEFINITION_DIR}/constitution.md; the constitution is human-owned.`,
  "",
  "`citedSignals` MUST list only signal ids that appear in the cluster you were given.",
  "Do not invent an id, and do not cite one twice. The citation is the receipt that",
  "earns the rule; a rule without one is a guess.",
  "",
  "Address the ROOT CAUSE, not the symptom. If the cluster does not justify a change,",
  "say so in the rationale and propose the smallest possible amendment anyway — the",
  "human will reject it, and that is a valid outcome.",
].join("\n");

/**
 * The proposer runs HERMETIC (no tools, no filesystem — see `shell/claude.ts`), so
 * everything it needs must be in the prompt. The first real run proved why: three of
 * four proposals came back as the literal word "placeholder", one of them explaining
 * "I don't have visibility into .wst/skills/voice.md". It was asked to amend a rule
 * it had never been shown.
 */
async function describeCluster(
  cluster: Cluster,
  definitionRoot: string,
  skillIndex: string,
): Promise<string> {
  const parts = [
    `Cluster: ${cluster.key} (${cluster.signals.length} signal(s))`,
    "",
    ...cluster.signals.map(
      (s) => `- ${s.id} [${s.severity}/${s.type}/${s.phase}] ${s.detail}`,
    ),
    "",
    `Skills that exist in this project (target one of these, or an ADR):`,
    skillIndex,
  ];

  if (cluster.key.startsWith("rule:")) {
    const rel = cluster.key.slice("rule:".length);
    try {
      const body = await readFile(join(definitionRoot, rel), "utf-8");
      parts.push(
        "",
        `CURRENT CONTENT of ${DEFINITION_DIR}/${rel} — amend THIS text, and do not restate a rule it`,
        `already contains:`,
        "",
        body.slice(0, 6000),
      );
    } catch {
      parts.push("", `(${DEFINITION_DIR}/${rel} could not be read — propose against the skill list above.)`);
    }
  }
  return parts.join("\n");
}

async function listSkills(definitionRoot: string): Promise<string> {
  try {
    const files = await readdir(join(definitionRoot, "skills"));
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => `  - ${DEFINITION_DIR}/skills/${f}`)
      .join("\n");
  } catch {
    return "  (none)";
  }
}

export async function runRetro(opts: RetroOptions = {}, cwd = process.cwd()): Promise<number> {
  const repoRoot = (await createGitAdapter(cwd).repoRoot()) ?? cwd;
  const definitionRoot = await resolveDefinitionRoot(repoRoot);

  const all = await readSignals(definitionRoot);
  const cursor = await readCursor(definitionRoot);

  let fresh;
  try {
    fresh = signalsSince(all, cursor);
  } catch (cause) {
    console.error((cause as Error).message);
    return 1;
  }

  console.log(`whetstone — retro\n`);
  console.log(`  signals   ${all.length} total · ${fresh.length} since ${cursor ?? "the beginning"}`);

  if (fresh.length === 0) {
    console.log(`\n  nothing new since the last retro.`);
    return 0;
  }

  const clusters = clusterSignals(fresh);
  const actionable = clusters.filter((c) => c.actionable);
  console.log(`  clusters  ${clusters.length} · ${actionable.length} actionable\n`);

  for (const c of clusters) {
    const mark = c.actionable ? "▶" : " ";
    console.log(`  ${mark} ${c.key.padEnd(42)} ${c.signals.length} signal(s)`);
  }

  if (opts.dryRun === true) {
    console.log(`\n  --dry-run: clustered only, no proposals generated.`);
    return 0;
  }
  if (actionable.length === 0) {
    console.log(`\n  no cluster is actionable yet. Recurrence is the trigger.`);
    return 0;
  }

  const skillIndex = await listSkills(definitionRoot);
  const judge = await resolveJudge(definitionRoot);
  const accepted: Recommendation[] = [];
  const rejected: { rec: Recommendation; reasons: readonly string[] }[] = [];
  let cost = 0;

  // One line per cluster, not one for the whole loop.
  //
  // Each iteration is a judge call at up to 3 attempts against a 120s timeout,
  // so ten clusters is an hour in the worst case. Printed once before the loop,
  // that is an hour of silence, which is indistinguishable from a hang — and it
  // got killed in the field, losing every proposal already paid for.
  console.log(`\n  proposing over ${actionable.length} cluster(s)...`);
  for (const [index, cluster] of actionable.entries()) {
    console.log(`    [${index + 1}/${actionable.length}] ${cluster.key}`);
    const result = await judge.judge({
      lens: LENS,
      prompt: await describeCluster(cluster, definitionRoot, skillIndex),
      schema: RecommendationSchema,
      model: opts.model ?? "sonnet",
      maxAttempts: 3,
    });
    cost += result.costUsd;

    if (!result.ok) {
      console.log(`        no proposal (${result.error.kind}) · $${cost.toFixed(4)} so far`);
      continue;
    }
    console.log(`        proposed · $${cost.toFixed(4)} so far`);

    const rec: Recommendation = { clusterKey: cluster.key, ...result.value };
    // THE ANTI-POISONING GATE. Validated against the FULL log, not the cluster,
    // so a fabricated id is caught even if it looks plausible.
    const check = validateRecommendation(rec, all);
    if (check.ok) accepted.push(rec);
    else rejected.push({ rec, reasons: check.reasons });
  }

  const lines: string[] = [
    `# Retro proposals`,
    ``,
    `Signals ${fresh[0]?.id} … ${fresh[fresh.length - 1]?.id} (${fresh.length} new).`,
    `**Nothing here has been applied.** Approving is a human act.`,
    ``,
  ];
  accepted.forEach((rec, i) => lines.push(renderProposal(rec, i + 1), ``));

  if (rejected.length > 0) {
    lines.push(`## Dropped by the anti-poisoning gate`, ``);
    for (const { rec, reasons } of rejected) {
      lines.push(`- **${rec.target}** — ${reasons.join("; ")}`);
    }
    lines.push(``);
  }

  // The Nth retro, counted from the log's own entries. It used to be the SIGNAL
  // count, so the first retro in a repo with ten signals wrote `retro-0010.md`,
  // and two retros at the same count overwrote each other.
  const retroId = `retro-${String((await countRetros(definitionRoot)) + 1).padStart(4, "0")}`;
  const path = await writeProposals(definitionRoot, retroId, lines.join("\n"));

  if (opts.json === true) {
    // The proposals as data. An agent handed prose paraphrases it, and a
    // paraphrased proposal is a rule change nobody approved.
    console.log(
      JSON.stringify(
        { ...retroEnvelope({ signals: all.length, fresh: fresh.length, clusters: clusters.length, accepted, rejected, costUsd: cost }), wrote: path },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`\n  ${accepted.length} proposal(s) survived the anti-poisoning gate`);
  if (rejected.length > 0) {
    console.log(`  ${rejected.length} dropped before reaching you:`);
    for (const { rec, reasons } of rejected) console.log(`    ${rec.target}: ${reasons[0]}`);
  }
  console.log(`  cost: $${cost.toFixed(4)}`);

  // The cursor is written HERE, not asked for. It is a mechanical fact — "this
  // run processed up to sig-x" — and leaving it to a human means the first
  // forgotten copy makes the next retro reprocess everything and pay again.
  // What the human owns is the sentence underneath: what was applied, and what
  // was refused.
  const cursorId = fresh[fresh.length - 1]?.id ?? cursor ?? "";
  let logged = false;
  if (cursorId !== "") {
    try {
      await appendRetroLogStub(definitionRoot, {
        retroId,
        cursor: cursorId,
        signals: all.length,
        clusters: clusters.length,
        actionable: actionable.length,
        costUsd: cost,
      });
      logged = true;
    } catch (cause) {
      console.log(`  could not append to the retro log: ${(cause as Error).message}`);
    }
  }

  console.log(`\n  wrote ${path}`);
  if (logged) {
    console.log(`  recorded "## ${retroId}" with \`cursor: ${cursorId}\` in ${DEFINITION_DIR}/memory/retro-log.md`);
  }
  console.log(`  Review the proposals. Nothing is applied until you apply it.`);
  console.log(`  Then say in that entry what you accepted and what you refused.`);
  return 0;
}
