import { describe, expect, it } from "vitest";
import { parseDecisions } from "./anchors.js";

const entry = (id: string, title: string, meta: string, body = "Rejected: something.") =>
  `### ${id} — ${title}\n${meta}\n\n${body}\n`;

const page = (...entries: string[]) => `# Decisions\n\nPreamble.\n\n---\n\n${entries.join("\n")}`;

describe("parseDecisions", () => {
  /**
   * The separator is a delimiter, not prose. Requiring one specific character
   * made the payload unshippable to a project that forbids em-dashes: `init`'s
   * own seeded example was rewritten with a colon, and every repo bootstrapped
   * from it would have carried an anchor its own parser rejects.
   */
  it.each([
    ["em dash", "### adr-0001 — memory is an interface"],
    ["en dash", "### adr-0001 – memory is an interface"],
    ["colon", "### adr-0001: memory is an interface"],
  ])("accepts %s as the separator", (_name, heading) => {
    const { entries, problems } = parseDecisions(`${heading}\n\`accepted\` · 2026-07-02\n\nRejected: x.\n`);

    expect(problems).toEqual([]);
    expect(entries[0]).toMatchObject({ id: "adr-0001", title: "memory is an interface" });
  });

  it("still rejects a heading with no separator at all", () => {
    const { problems } = parseDecisions("### adr-0001 memory is an interface\n`accepted` · 2026-07-02\n");

    expect(problems[0]?.why).toContain("### adr-NNNN");
  });

  it("reads id, title, status and date off each entry", () => {
    const text = page(
      entry("adr-0001", "memory is an interface", "`accepted` · 2026-07-02"),
      entry("adr-0002", "the definition directory is the source", "`proposed` · 2026-07-06"),
    );

    const { entries, problems } = parseDecisions(text);

    expect(problems).toEqual([]);
    expect(entries).toEqual([
      { id: "adr-0001", title: "memory is an interface", status: "accepted", date: "2026-07-02", line: 7 },
      { id: "adr-0002", title: "the definition directory is the source", status: "proposed", date: "2026-07-06", line: 12 },
    ]);
  });

  it("keeps the id a supersession points at", () => {
    const text = page(entry("adr-0001", "amends by status", "`superseded by adr-0019` · 2026-07-14"));

    const { entries } = parseDecisions(text);

    expect(entries[0]?.status).toBe("superseded by adr-0019");
  });

  it("accepts the optional trailing fields", () => {
    const text = page(
      entry("adr-0001", "the payload is the value", "`accepted` · 2026-07-11 · signals: sig-0001 · rules: retro.md"),
    );

    const { entries, problems } = parseDecisions(text);

    expect(problems).toEqual([]);
    expect(entries[0]?.date).toBe("2026-07-11");
  });

  it("ignores a heading inside a fence — the page showing what an entry looks like", () => {
    const text = page(
      "```\n### adr-0011 — build the event log\n`accepted` · 2026-08-09\n```\n",
      entry("adr-0001", "memory is an interface", "`accepted` · 2026-07-02"),
    );

    const { entries, problems } = parseDecisions(text);

    expect(problems).toEqual([]);
    expect(entries.map((e) => e.id)).toEqual(["adr-0001"]);
  });

  it("reports a heading that is not `### adr-NNNN — title`", () => {
    const text = page("### memory is an interface\n\nRejected: something.\n");

    const { entries, problems } = parseDecisions(text);

    expect(entries).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.why).toContain("### adr-NNNN — title");
  });

  it("reports a second anchor for one id, because a citation would resolve to whichever comes first", () => {
    const text = page(
      entry("adr-0001", "memory is an interface", "`accepted` · 2026-07-02"),
      entry("adr-0001", "memory is an interface, again", "`accepted` · 2026-07-03"),
    );

    const { entries, problems } = parseDecisions(text);

    expect(entries.map((e) => e.id)).toEqual(["adr-0001"]);
    expect(problems[0]?.why).toContain("already has an anchor");
  });

  it("reports a gap in the sequence, which is a decision gone missing", () => {
    const text = page(
      entry("adr-0001", "memory is an interface", "`accepted` · 2026-07-02"),
      entry("adr-0003", "human-gated", "`accepted` · 2026-07-06"),
    );

    const { problems } = parseDecisions(text);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.why).toContain("expected adr-0002");
  });

  it("reports a missing meta line, which is how `status` goes quiet", () => {
    const text = page("### adr-0001 — memory is an interface\n\nRejected: something.\n");

    const { entries, problems } = parseDecisions(text);

    // The entry is still known — a citation of it resolves — but it carries no
    // status, so nothing can say whether the decision is in force.
    expect(entries.map((e) => e.id)).toEqual(["adr-0001"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.why).toContain("no meta line");
  });

  it("reports a meta line whose status is not one of the three", () => {
    const text = page(entry("adr-0001", "memory is an interface", "`draft` · 2026-07-02"));

    const { problems } = parseDecisions(text);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(8);
  });

  it("finds nothing in a page with no entries, and says so by returning none", () => {
    const { entries, problems } = parseDecisions("# Decisions\n\nNothing yet.\n");

    expect(entries).toEqual([]);
    expect(problems).toEqual([]);
  });
});
