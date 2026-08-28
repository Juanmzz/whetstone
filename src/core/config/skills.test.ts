import { describe, expect, it } from "vitest";
import { summaryOf } from "./skills.js";

const skill = (body: string): string => `---\nid: x\nversion: 1\nstatus: active\n---\n${body}`;

describe("summaryOf — one line saying what a skill governs", () => {
  it("takes the first sentence of the prose, not the heading", () => {
    // The heading is the id spelled out; `Voice` tells nobody what Voice does.
    const text = skill("# Voice\n\nHow the agent engages the human in conversation: the working\nrelationship, not the artifacts. This governs REPLY TEXT only.\n");

    expect(summaryOf(text)).toBe(
      "How the agent engages the human in conversation: the working relationship, not the artifacts.",
    );
  });

  it("falls back to the heading where there is no prose to take", () => {
    expect(summaryOf(skill("# Token economy\n\n## Rules\n"))).toBe("Token economy");
  });

  it("strips the markdown a terminal cannot render", () => {
    const text = skill("# Lazy\n\nThe best code is the **code never written**, per [[doc-locations]] and `wst`.\n");

    expect(summaryOf(text)).toBe(
      "The best code is the code never written, per doc-locations and wst.",
    );
  });

  it("answers with the empty string rather than throwing on a file it cannot read", () => {
    expect(summaryOf("")).toBe("");
    expect(summaryOf("---\nid: x\n---\n")).toBe("");
  });

  it("stops at the first sentence, so a paragraph does not become the row", () => {
    const text = skill("# X\n\nOne. Two. Three.\n");
    expect(summaryOf(text)).toBe("One.");
  });
});
