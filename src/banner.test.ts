import { describe, expect, it } from "vitest";
import { MARK, MARK_HOME } from "./banner.js";
import { buildStatusReport, type StatusFacts } from "./core/status/report.js";
import { openHome, renderHome } from "./core/tui/home.js";

const STONE = MARK[0]!.length;

const facts: StatusFacts = {
  repoRoot: "/repo",
  branch: "main",
  definitionPresent: true,
  judge: { name: "claude", version: "2.1.245" },
  nodeVersion: "v24.0.0",
  hooks: { configuredPath: ".githooks", whetstoneHooksPresent: true, gateInPrePush: null },
  plugin: {
    install: "absent",
    hookRoot: "/repo",
    hookRootIsRepo: true,
    hookRootHasDefinition: true,
    definitionTracked: true,
  },
};

describe("MARK_HOME: the word beside the stone", () => {
  it("puts the word to the right of the stone and adds no row to do it", () => {
    expect(MARK_HOME).toHaveLength(MARK.length);
    expect(MARK_HOME[0]?.length ?? 0).toBeGreaterThan(STONE);
  });

  it("gives the word more than the one row it used to have", () => {
    // It was a line of the menu. Beside the stone it is pixel art, and the
    // point of moving it is that it is now big enough to read as a wordmark.
    const rows = MARK_HOME.filter((row) =>
      row.slice(STONE).some((c) => c.top !== null || c.bottom !== null),
    );

    expect(rows.length).toBeGreaterThan(1);
  });

  it("leaves the stone itself untouched", () => {
    for (const [i, row] of MARK.entries()) expect(MARK_HOME[i]?.slice(0, STONE)).toEqual(row);
  });

  it("keeps the whole block inside an eighty-column terminal", () => {
    for (const row of MARK_HOME) expect(row.length).toBeLessThanOrEqual(80);
  });
});

describe("the home screen's height", () => {
  it("still fits a default terminal, mark and menu together", () => {
    // The constraint the wordmark had to respect: twenty-four rows, no separator
    // to give up a second time. Moving the word out of the menu freed one.
    const screen = MARK_HOME.length + renderHome(openHome(buildStatusReport(facts))).length;

    expect(screen).toBeLessThanOrEqual(24);
  });
});
