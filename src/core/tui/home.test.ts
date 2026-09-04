import { describe, expect, it } from "vitest";
import { buildStatusReport, type StatusFacts } from "../status/report.js";
import { openHome, pressHome, renderHome } from "./home.js";

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

const open = (over: Partial<StatusFacts> = {}) => openHome(buildStatusReport(facts(over)));
const screen = (over: Partial<StatusFacts> = {}) => renderHome(open(over)).join("\n");
const at = (start: ReturnType<typeof open>, keys: readonly string[]) =>
  keys.reduce((s, k) => pressHome(s, k).state, start);

describe("the primary screen", () => {
  it("offers the three commands of the product, and a drawer", () => {
    expect(open().rows.map((r) => r.entry)).toEqual(["init", "ready", "status", "diagnostics"]);
  });

  it("names them as outcomes a person wants, not as commands to learn", () => {
    const text = screen();
    for (const said of ["Initialize verification", "Check readiness", "Show status", "Advanced diagnostics"]) {
      expect(text).toContain(said);
    }
  });

  it("shows no standby command anywhere", () => {
    // `signal` is the [RC3] gate and a human types it; `retro` and `update` are off
    // the product path. A row for any of them is a route back onto it.
    const text = `${screen()}\n${renderHome(at(open(), ["down", "down", "down", "return"])).join("\n")}`;
    for (const gone of ["signal", "retro", "update", "config", "gate"]) {
      expect(text.toLowerCase()).not.toContain(gone);
    }
  });

  it("says in one line what this repo needs now", () => {
    expect(screen({ uncommitted: ["src/a.ts", "src/b.ts"] })).toContain("2 uncommitted file(s)");
  });
});

describe("availability", () => {
  it("offers init where there is no definition layer, and nothing that reads one", () => {
    const rows = open({ definitionPresent: false }).rows;
    expect(rows.find((r) => r.entry === "init")?.available).toBe(true);
    expect(rows.find((r) => r.entry === "ready")?.available).toBe(false);
    expect(rows.find((r) => r.entry === "status")?.available).toBe(true);
  });

  it("marks an unavailable row rather than hiding it", () => {
    // A command that disappears reads as one that does not exist.
    expect(screen({ definitionPresent: false })).toMatch(/Check readiness\s+needs init/);
  });

  it("says init is already done rather than offering to redo it", () => {
    expect(screen()).toMatch(/Initialize verification\s+already done/);
  });

  it("refuses to run a row that cannot run", () => {
    const home = open({ definitionPresent: false });
    expect(pressHome({ ...home, cursor: 1 }, "return").action).toEqual({ kind: "none" });
    expect(pressHome({ ...open(), cursor: 0 }, "return").action).toEqual({ kind: "none" });
  });

  it("offers only status outside a git repository", () => {
    const rows = open({ repoRoot: null, branch: null }).rows;
    expect(rows.filter((r) => r.available)).toHaveLength(0);
    expect(screen({ repoRoot: null, branch: null })).toContain("needs a git repo");
  });
});

describe("the diagnostics drawer", () => {
  const drawer = () => at(open(), ["down", "down", "down", "return"]);

  it("opens on enter rather than running anything", () => {
    expect(pressHome(at(open(), ["down", "down", "down"]), "return").action).toEqual({ kind: "none" });
    expect(drawer().view).toBe("advanced");
  });

  it("holds triage and the registry, which are for agents and maintainers", () => {
    expect(drawer().advanced.map((r) => r.entry)).toEqual(["triage", "check"]);
  });

  it("comes back with esc, which does not quit from in there", () => {
    const back = pressHome(drawer(), "escape");
    expect(back.action).toEqual({ kind: "none" });
    expect(back.state.view).toBe("primary");
  });

  it("runs the row under the cursor", () => {
    expect(pressHome(drawer(), "return").action).toEqual({ kind: "run", command: "triage" });
  });
});

describe("moving and leaving", () => {
  it("runs the row under the cursor on the primary screen", () => {
    expect(pressHome(open({ definitionPresent: false }), "return").action).toEqual({
      kind: "run",
      command: "init",
    });
    expect(pressHome(open(), "return").action).toEqual({ kind: "run", command: "ready" });
  });

  it("opens on the first row somebody can press enter on", () => {
    // In an initialised repo `init` says `already done`, and opening there makes
    // the first keystroke of every session do nothing.
    expect(open().cursor).toBe(1);
    expect(open({ definitionPresent: false }).cursor).toBe(0);
  });

  it("moves with the arrows and with vim keys, since no row is a text field", () => {
    expect(at(open(), ["j"]).cursor).toBe(2);
    expect(at(open(), ["j", "k"]).cursor).toBe(1);
    expect(at(open(), ["up"]).cursor).toBe(0);
  });

  it("clamps rather than wraps: a cursor that wraps stops being a position", () => {
    expect(at(open(), Array<string>(9).fill("up")).cursor).toBe(0);
    expect(at(open(), Array<string>(9).fill("down")).cursor).toBe(3);
  });

  it("quits on q, and on esc from the primary screen", () => {
    expect(pressHome(open(), "q").action).toEqual({ kind: "quit" });
    expect(pressHome(open(), "escape").action).toEqual({ kind: "quit" });
  });
});

describe("what the screen says about state", () => {
  it("prints the repo, the branch and the judge, so the choice is not blind", () => {
    expect(screen()).toContain("repo");
    expect(screen()).toContain("main");
    expect(screen()).toContain("claude");
  });

  it("says whether verification runs on a push, in words", () => {
    expect(screen()).toContain("verification runs on every push");
    expect(screen({ hooks: { configuredPath: null, whetstoneHooksPresent: false, gateInPrePush: null } }))
      .toContain("verification runs when you ask");
  });

  it("shows no process exit number anywhere on any screen", () => {
    for (const text of [screen(), screen({ definitionPresent: false }), renderHome(at(open(), ["down","down","down","return"])).join("\n")]) {
      expect(text).not.toMatch(/exit \d/);
    }
  });

  it("keeps every line inside a default terminal", () => {
    for (const line of renderHome(open())) expect(line.length).toBeLessThanOrEqual(80);
  });
});
