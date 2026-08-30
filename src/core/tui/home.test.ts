import { describe, expect, it } from "vitest";
import { buildStatusReport, type StatusFacts } from "../status/report.js";
import { homeRows, openHome, pressHome, renderHome, type HomeCommand } from "./home.js";

const facts = (over: Partial<StatusFacts> = {}): StatusFacts => ({
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
      hooks: { configuredPath: null, whetstoneHooksPresent: true, gateInPrePush: null },
    });
    expect(gate?.note).toMatch(/pre-push/i);
  });

  it("never offers signal, which is the one command a human types with an argument", () => {
    // `wst signal` IS the [RC3] gate. Behind a menu pick it becomes a click, and a
    // click is not an attestation.
    expect(homeRows(report()).map((r) => r.command)).not.toContain("signal");
  });
});

// The index, which is now one key in. `now` is what opens; `?` is the list.
const open = (over: Partial<StatusFacts> = {}) => pressHome(openHome(report(over)), "?").state;

describe("pressHome", () => {

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
    const screen = renderHome(open()).join("\n");
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

  it("does not name the repo again: the word now sits beside the stone", () => {
    // It was the first line of this list, one row of nine characters under a
    // thirty-column drawing. `banner.ts` draws it, and the row it cost is back.
    expect(renderHome(open())).not.toContain("whetstone");
  });

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

/**
 * `not now` said two opposite things. On `init` it meant "already done"; on
 * everything else it meant "cannot yet, and here is what first". A reader has to
 * open the detail to tell which, and the word is the only thing on the row.
 */
describe("a row says which kind of unavailable it is", () => {
  it("says what a blocked row is waiting for, in the row itself", () => {
    const rows = homeRows(report({ definitionPresent: false }));
    const gate = rows.find((r) => r.command === "gate");

    expect(gate?.available).toBe(false);
    expect(gate?.state).toBe("needs init");
  });

  it("says a done row is done, which is the opposite state and used to share a word", () => {
    expect(rowFor("init")?.state).toBe("already done");
  });

  it("says nothing extra on a row you can just run", () => {
    expect(rowFor("gate")?.state).toBeNull();
  });

  it("says what is missing outside a git repository", () => {
    expect(rowFor("gate", { repoRoot: null })?.state).toBe("needs a git repo");
  });

  it("shows the state on the row rather than only under the cursor", () => {
    const screen = renderHome(open({ definitionPresent: false })).join("\n");
    expect(screen).toMatch(/gate\s+needs init/);
  });

  it("never prints the words `not now`, which said both things at once", () => {
    for (const facts of [{}, { definitionPresent: false }, { repoRoot: null }]) {
      expect(renderHome(openHome(report(facts))).join("\n")).not.toContain("not now");
    }
  });
});

describe("what this repo should do now", () => {
  const withFacts = (over: Partial<StatusFacts>) => openHome(report(over));

  it("leads with init when there is no definition layer", () => {
    const home = withFacts({ definitionPresent: false });
    expect(home.lead.command).toBe("init");
    expect(home.lead.because).toMatch(/nothing here yet|no .*\/ yet/i);
  });

  it("leads with the gate when there is uncommitted work", () => {
    // The eight-row index shows everything the tool can do. What a person opening
    // it wants is the one thing this repo needs now.
    const home = withFacts({ uncommitted: ["src/a.ts", "src/b.ts", "README.md"] });
    expect(home.lead.command).toBe("gate");
    expect(home.lead.because).toContain("3");
  });

  it("leads with retro when the log has moved and the tree has not", () => {
    const home = withFacts({
      uncommitted: [],
      freshSignals: { kind: "counted" as const, count: 6, since: "sig-39f4aa1e" },
    });
    expect(home.lead.command).toBe("retro");
  });

  it("leads with status when there is nothing else to say", () => {
    expect(withFacts({ uncommitted: [] }).lead.command).toBe("status");
  });

  it("prefers a missing definition layer over uncommitted work", () => {
    // A repo with no `.wst/` has nothing to gate against, so the gate is not the
    // answer however dirty the tree is.
    const home = withFacts({ definitionPresent: false, uncommitted: ["src/a.ts"] });
    expect(home.lead.command).toBe("init");
  });
});

describe("the two views", () => {
  const home = () => openHome(report({ uncommitted: ["src/a.ts"] }));

  it("opens on the one action, not on the index", () => {
    const screen = renderHome(home()).join("\n");
    expect(screen).toContain("run the checks");
    expect(screen).not.toContain("classify the change");
  });

  it("keeps every row behind `?`, so nothing is hidden, only subordinated", () => {
    const all = pressHome(home(), "?").state;
    const screen = renderHome(all).join("\n");
    for (const command of ["status", "init", "gate", "triage", "check", "config", "update", "retro"]) {
      expect(screen).toContain(command);
    }
  });

  it("comes back from the index the same way it went in", () => {
    const there = pressHome(home(), "?").state;
    expect(pressHome(there, "?").state.view).toBe("now");
  });

  it("runs the lead on enter", () => {
    expect(pressHome(home(), "return").action).toEqual({ kind: "run", command: "gate" });
  });

  it("runs retro on `r` when the log has something to work on", () => {
    const withSignals = openHome(
      report({ uncommitted: [], freshSignals: { kind: "counted", count: 6, since: "s" } }),
    );
    expect(pressHome(withSignals, "r").action).toEqual({ kind: "run", command: "retro" });
  });

  it("does not offer retro when there is nothing new to cluster", () => {
    const quiet = openHome(report({ uncommitted: [] }));
    expect(pressHome(quiet, "r").action).toEqual({ kind: "none" });
    expect(renderHome(quiet).join("\n")).not.toMatch(/^.*signals.*r$/m);
  });
});
