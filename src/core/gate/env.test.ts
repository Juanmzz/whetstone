import { describe, expect, it } from "vitest";
import { checkEnv } from "./env.js";

const BASE = { PATH: "/usr/bin", HOME: "/home/x" };

describe("checkEnv — what a check is told about where it is running", () => {
  it("names the checkout being verified, so a config can tell two apart", () => {
    const env = checkEnv(BASE, "/repos/feature-a");

    expect(env["WST_GATE_CWD"]).toBe("/repos/feature-a");
  });

  it("derives a stable port offset from that path", () => {
    // A leased worktree and the main checkout must not agree on a port, or a
    // server started by one is reused by the other and the gate verifies code
    // the author never wrote.
    const a = checkEnv(BASE, "/repos/feature-a")["WST_GATE_PORT_OFFSET"];
    const b = checkEnv(BASE, "/repos/feature-b")["WST_GATE_PORT_OFFSET"];

    expect(a).not.toBe(b);
    expect(Number(a)).toBeGreaterThanOrEqual(0);
    expect(Number(a)).toBeLessThan(1000);
  });

  it("gives the same checkout the same offset every run, or a receipt means nothing", () => {
    expect(checkEnv(BASE, "/repos/a")).toEqual(checkEnv(BASE, "/repos/a"));
  });

  it("keeps everything the parent had", () => {
    expect(checkEnv(BASE, "/repos/a")["PATH"]).toBe("/usr/bin");
  });

  it("does not let the parent's own value win, since it may be a stale worktree's", () => {
    const inherited = { ...BASE, WST_GATE_CWD: "/repos/somewhere-else" };

    expect(checkEnv(inherited, "/repos/a")["WST_GATE_CWD"]).toBe("/repos/a");
  });
});
