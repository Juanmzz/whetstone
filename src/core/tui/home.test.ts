import { describe, expect, it } from "vitest";
import { buildStatusReport, type StatusFacts } from "../status/report.js";
import { homeRows, openHome, pressHome, renderHome, type HomeCommand } from "./home.js";

const facts = (over: Partial<StatusFacts> = {}): StatusFacts => ({
  repoRoot: "/repo",
  branch: "main",
  definitionPresent: true,
  judge: { name: "claude", version: "2.1.245" },
  nodeVersion: "v24.0.0",
  hooks: { configuredPath: ".githooks", whetstoneHooksPresent: true },
  plugin: {
    install: "absent",
    hookRoot: "/repo",
    hookRootIsRepo: true,
    hookRootHasDefinition: true,
    definitionTracked: true,
  },
  ...over,
});

const report = (over: Partial<StatusFacts> = {}) => buildStatusReport(facts(over));
const rowFor = (command: HomeCommand, over: Partial<StatusFacts> = {}) =>
  homeRows(report(over)).find((r) => r.command === command);

describe("homeRows — the list says what this repo can actually do", () => {
  it("offers init where there is no definition layer, and nothing that reads one", () => {
    const rows = homeRows(report({ definitionPresent: false }));
    expect(rowFor("init", { definitionPresent: false })?.available).toBe(true);

    for (const row of rows) {
      // `status` stays: it is the command that reports there is no layer, so
      // greying it out would hide the answer behind the question.
      if (row.command === "init" || row.command === "status") continue;
      expect(row.available).toBe(false);
      expect(row.note).toMatch(/init/);
    }
  });

  it("retires init once the layer exists, and points at update instead", () => {
    const init = rowFor("init");
    expect(init?.available).toBe(false);
    expect(init?.note).toMatch(/update/);
  });

  it("offers nothing but status outside a git repository", () => {
    const rows = homeRows(report({ repoRoot: null, definitionPresent: false }));
    const available = rows.filter((r) => r.available).map((r) => r.command);
    expect(available).toEqual(["status"]);
  });

  /**
   * The gate runs deterministic checks with no judge at all. A home that greys it
   * out for a missing binary would be telling someone their gate is unusable when
   * the half that blocks in the pre-push hook still runs.
   */
  it("keeps gate available with no judge on PATH, and says what will not run", () => {
    const gate = rowFor("gate", { judge: { name: "claude", version: null } });
    expect(gate?.available).toBe(true);
    expect(gate?.note).toMatch(/llm/i);
  });

  it("says on the gate row when the pre-push hook is not armed", () => {
    const gate = rowFor("gate", {
      hooks: { configuredPath: null, whetstoneHooksPresent: true },
    });
    expect(gate?.note).toMatch(/pre-push/i);
  });

  it("never offers signal, which is the one command a human types with an argument", () => {
    // `wst signal` IS the [RC3] gate. Behind a menu pick it becomes a click, and a
    // click is not an attestation.
    expect(homeRows(report()).map((r) => r.command)).not.toContain("signal");
  });
});

describe("pressHome", () => {
  const open = (over: Partial<StatusFacts> = {}) => openHome(report(over));

  it("runs the row under the cursor", () => {
    const { action } = pressHome(open(), "return");
    expect(action).toEqual({ kind: "run", command: homeRows(report())[0]?.command });
  });

  it("moves with the arrows and with vim keys, since no row is a text field", () => {
    const down = pressHome(open(), "j").state;
    expect(down.cursor).toBe(1);
    expect(pressHome(down, "k").state.cursor).toBe(0);
    expect(pressHome(open(), "down").state.cursor).toBe(1);
  });

  it("clamps rather than wraps: a cursor that wraps stops being a position", () => {
    expect(pressHome(open(), "up").state.cursor).toBe(0);
  });

  it("refuses to run an unavailable row", () => {
    const rows = homeRows(report());
    const at = rows.findIndex((r) => !r.available);
    let state = open();
    for (let i = 0; i < at; i++) state = pressHome(state, "down").state;

    expect(pressHome(state, "return").action.kind).toBe("none");
  });

  it("quits on q and on escape", () => {
    expect(pressHome(open(), "q").action).toEqual({ kind: "quit" });
    expect(pressHome(open(), "escape").action).toEqual({ kind: "quit" });
  });

  it("keeps every row on the list, available or not", () => {
    // A command that disappears reads as one that does not exist.
    expect(homeRows(report()).length).toBe(homeRows(report({ definitionPresent: false })).length);
  });
});

describe("renderHome", () => {
  it("prints the repo's state above the list, so the choice is not blind", () => {
    const screen = renderHome(open()).join("\n");
    expect(screen).toContain("main");
    expect(screen).toContain("claude");
  });

  it("marks an unavailable row, rather than hiding it and shortening the list", () => {
    // A command that disappears reads as a command that does not exist. It is
    // here, and the note says what it is waiting for.
    const screen = renderHome(openHome(report())).join("\n");
    expect(screen).toMatch(/init/);
  });

  it("says the reason once, under the cursor, and not also inline", () => {
    // Both at once is one sentence twice on one screen, and the inline copy ran
    // off the side of a default terminal.
    const rows = homeRows(report());
    const at = rows.findIndex((r) => !r.available);
    let state = open();
    for (let i = 0; i < at; i++) state = pressHome(state, "down").state;
    const note = rows[at]?.note ?? "";

    const screen = renderHome(state).join("\n");

    expect(screen).toContain(note);
    expect(screen.split(note).length - 1).toBe(1);
  });

  it("keeps every line inside a default terminal", () => {
    for (const line of renderHome(open())) expect(line.length).toBeLessThanOrEqual(80);
  });

  const open = () => openHome(report());
});

describe("the row says what the command does, which is what the launcher is for", () => {
  it("gives every command a detail, not only a one-liner", () => {
    // `wst --help` already gives one line each. Somebody picking between
    // `triage` and `gate` needs to know one of them runs nothing.
    for (const row of homeRows(report())) expect(row.detail.length).toBeGreaterThan(0);
  });

  it("says what the gate's two failing codes mean, which no other page does", () => {
    const gate = rowFor("gate")?.detail.join(" ") ?? "";
    expect(gate).toMatch(/exit 1/);
    expect(gate).toMatch(/exit 2/);
    expect(gate).toMatch(/could not/i);
  });

  it("warns that retro spends money before it is picked, not after", () => {
    const retro = rowFor("retro")?.detail.join(" ") ?? "";
    expect(retro).toMatch(/costs money/i);
    expect(retro).toMatch(/never applies/i);
  });

  it("says triage runs nothing, which is the whole difference from gate", () => {
    expect(rowFor("triage")?.detail.join(" ")).toMatch(/nothing runs/i);
  });

  it("shows a detail for the row under the cursor and no other", () => {
    const screen = renderHome(openHome(report())).join("\n");
    const others = homeRows(report()).filter((r) => r.command !== "status");
    for (const row of others) expect(screen).not.toContain(row.detail[0]);
  });

  it("keeps every detail line inside a default terminal", () => {
    for (const row of homeRows(report())) {
      for (const line of row.detail) expect(line.length).toBeLessThanOrEqual(66);
    }
  });
});
