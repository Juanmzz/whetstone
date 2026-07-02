# Open questions

Design questions to resolve before they become GitHub issues. Kept local while the
project is pre-alpha — no repo ceremony until the thesis is validated (see VISION.md).

Sourced from SPEC.md §4.

1. **Incident `type` vocabulary** — open (as spec'd) vs. curated enum with `other`?
   Trade-off: open is friction-free to log but noisy for `Detect`; an enum makes grouping
   reliable but needs maintenance.

2. **Are decisions retro-amendable?** — should the retro flip ADR `status`
   (proposed → accepted → superseded), or are decisions strictly human-managed prose?

3. **Multi-agent writes to `incidents.jsonl`** — is append-only + git merge enough, or do
   we need per-session files merged at retro time to avoid concurrent-append conflicts?

4. **Where does the init interview live?** — static questionnaire vs. agent-driven
   conversation with the codebase? (Affects M1 scope directly.)
