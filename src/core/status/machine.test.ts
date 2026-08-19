import { describe, expect, it } from "vitest";
import { statusEnvelope } from "./machine.js";
import { buildStatusReport, type StatusFacts } from "./report.js";

const facts = (over: Partial<StatusFacts> = {}): StatusFacts => ({
  repoRoot: "/repos/acme",
  branch: "main",
  definitionPresent: true,
  judge: { name: "claude", version: "2.1.224" },
  nodeVersion: "v24.19.0",
  hooks: { configuredPath: ".githooks", whetstoneHooksPresent: true },
  plugin: {
    install: "enabled",
    hookRoot: "/repos/acme",
    hookRootIsRepo: true,
    hookRootHasDefinition: true,
    definitionTracked: true,
  },
  ...over,
});

describe("statusEnvelope — what an agent needs before it acts", () => {
  it("answers ready as a boolean, not as a sentence to parse", () => {
    expect(statusEnvelope(buildStatusReport(facts())).ready).toBe(true);
  });

  it("keeps problems apart from warnings, since only one of them blocks", () => {
    const env = statusEnvelope(buildStatusReport(facts({ definitionPresent: false })));

    expect(env.ready).toBe(false);
    expect(env.problems.length).toBeGreaterThan(0);
  });

  it("says whether the gate has a live route from here", () => {
    // The question every other one is asked in service of. Prose said it;
    // nothing returned it.
    expect(statusEnvelope(buildStatusReport(facts())).enforcement).toEqual({
      prePush: true,
      plugin: "enabled",
    });
  });

  it("reports no route when husky owns the path and no plugin is installed", () => {
    const env = statusEnvelope(
      buildStatusReport(
        facts({
          hooks: { configuredPath: ".husky/_", whetstoneHooksPresent: false },
          plugin: {
            install: "absent",
            hookRoot: "/repos/acme",
            hookRootIsRepo: true,
            hookRootHasDefinition: true,
            definitionTracked: true,
          },
        }),
      ),
    );

    expect(env.enforcement).toEqual({ prePush: false, plugin: "absent" });
  });

  it("resolves an absolute hooksPath as armed, like the renderer does", () => {
    // `sig-4b3339fb`: the string form reported an armed hook as unarmed. The
    // envelope must not reintroduce the comparison the renderer stopped doing.
    const env = statusEnvelope(
      buildStatusReport(facts({ hooks: { configuredPath: "/repos/acme/.githooks", whetstoneHooksPresent: true } })),
    );

    expect(env.enforcement.prePush).toBe(true);
  });

  it("is ready and unenforced at the same time, which is a real state", () => {
    // Measured in a real repo: `.wst/` present, husky owning the hooks path, no
    // plugin. Every command works and NOTHING runs the gate on its own. An agent
    // reading only `ready` would conclude the opposite, which is why enforcement
    // is a field and not a sentence inside `warnings`.
    const env = statusEnvelope(
      buildStatusReport(
        facts({
          hooks: { configuredPath: ".husky/_", whetstoneHooksPresent: false },
          plugin: {
            install: "absent",
            hookRoot: "/repos/acme",
            hookRootIsRepo: true,
            hookRootHasDefinition: true,
            definitionTracked: true,
          },
        }),
      ),
    );

    expect(env.ready).toBe(true);
    expect(env.enforcement).toEqual({ prePush: false, plugin: "absent" });
  });

  it("survives a round trip through JSON, so a consumer never meets undefined", () => {
    const env = statusEnvelope(buildStatusReport(facts({ repoRoot: null, branch: null })));

    expect(JSON.parse(JSON.stringify(env))).toEqual(env);
  });
});
