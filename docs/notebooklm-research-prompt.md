# NotebookLM research prompt — "How to work better with AI coding agents"

Purpose: use NotebookLM as a source-grounded aggregator to distill best practices for working
with AI coding agents, structured so the output maps directly onto Whetstone's artifacts
(incident taxonomy, skill rules, triage conditions, init-interview questions).

NotebookLM is only as good as its sources. **Add sources first, then paste the prompt.**

## Suggested sources to add first

- Anthropic's Claude Code documentation and "best practices for agentic coding" posts.
- The `AGENTS.md` specification / site (agents.md) and a few widely-starred `AGENTS.md` /
  `CLAUDE.md` / `.cursorrules` examples from real repos.
- GitHub Spec Kit, BMAD-METHOD, and Superpowers docs/READMEs (the forward-path frameworks).
- DSPy docs and a Reflexion paper/summary (the autonomous-optimization contrast).
- 3–5 engineering blog posts on real AI-agent workflow lessons (context management, TDD with
  agents, delegation/sub-agents, review gates, token economy).
- Optional: mem0 / Letta docs (agent-memory contrast).

## The prompt (paste into NotebookLM)

```
You are a research analyst. Using ONLY the sources in this notebook, produce a structured,
evidence-grounded synthesis titled "Best practices for working with AI coding agents."

I am building a tool that bootstraps and then continuously improves the workflow rules a
coding agent follows on a given project. I need your output organized into these four
sections, because each maps to an artifact I will build:

1. FAILURE MODES & ANTI-PATTERNS (→ my incident taxonomy)
   List the recurring ways working with AI coding agents goes wrong (e.g. wrong working
   directory, skipped tests, scope creep, context/token blowout, hallucinated APIs,
   over-broad edits). For each: a short kebab-case name, a one-line description, the workflow
   phase it usually strikes (init / plan / apply / review), and how often sources treat it as
   high-severity.

2. WORKFLOW DISCIPLINES THAT WORK (→ my skill rules)
   The practices sources agree actually help: spec-first, test-first/TDD with agents,
   delegation to sub-agents / fresh context, context & token management, human review gates,
   persistent project memory, small atomic changes. For each discipline give 2–5 CONCRETE,
   enforceable rules (imperative, one line each) — not generic advice.

3. ENCODING & EVOLVING RULES (→ my constitution + feedback-loop thesis)
   How teams encode agent rules in config files (CLAUDE.md / AGENTS.md / .cursorrules), and
   how (if at all) they keep those rules updated as they learn. Note explicitly whether
   sources describe a FEEDBACK loop (updating rules from real incidents) or only static,
   hand-written config.

4. PROJECT-SETUP QUESTIONS (→ my init interview)
   The handful of questions worth asking when setting up an agent on a new project (stack,
   risk profile e.g. handles money/PII, test setup, team conventions, critical paths) whose
   answers most change how the agent should behave.

Rules for your output:
- Ground every claim in the sources and cite which source supports it.
- Mark each practice as CONSENSUS, COMMON, or CONTESTED across sources.
- Where a practice depends on the project's stack or risk profile, say so explicitly.
- Prefer concrete, testable rules over vague principles.
- End with "GAPS": important questions my sources do NOT answer.

Format as clean markdown with those four numbered sections.
```

## After you get the output

- Section 1 → candidate `type` vocabulary for `.sdd/memory/incidents.jsonl` (feeds
  `OPEN_QUESTIONS.md` #1).
- Section 2 → rules to add/adjust in `.sdd/skills/*.md` (with real receipts once sources back
  them).
- Section 3 → evidence for/against the retro-loop thesis; sharpen positioning.
- Section 4 → the init interview's question set.

Note: prompt is in English for better grounding and to match the (English) project artifacts.
Ask NotebookLM for a Spanish version of the output if you prefer to read it in Spanish.
