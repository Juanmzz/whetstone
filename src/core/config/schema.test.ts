import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "./schema.js";

describe("parseConfig", () => {
  it("defaults a repo that has no wst.yaml", () => {
    expect(parseConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it("keeps the defaults for keys the file omits", () => {
    // `wst.yaml` carries version, memory, retro and skills as well. Reading it
    // strictly would make every unrelated key a parse failure.
    expect(parseConfig({ retro: { suggest_after: 5 } })).toEqual(DEFAULT_CONFIG);
  });

  it("reads what the file declares", () => {
    expect(parseConfig({ agent: "claude", backend: "files" })).toEqual({
      agent: "claude",
      backend: "files",
    });
  });

  it("throws on an agent it cannot run, rather than falling back to claude", () => {
    // The whole point of the key. Silently running claude under another name is
    // invisible: the run succeeds and the verdict looks normal, so nobody learns
    // the judge they asked for was never consulted.
    expect(() => parseConfig({ agent: "codex" })).toThrow(/wst\.yaml: agent/);
  });

  it("accepts an agent that HAS an adapter, which is what makes the key mean anything", () => {
    expect(parseConfig({ agent: "antigravity" }).agent).toBe("antigravity");
  });

  it("throws on a backend nothing implements", () => {
    expect(() => parseConfig({ backend: "engram" })).toThrow(/wst\.yaml: backend/);
  });
});
