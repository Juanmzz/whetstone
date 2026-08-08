import { describe, expect, it, vi } from "vitest";
import { buildRegistry, type LoadedCheck } from "../checks/registry.js";
import type { Routing } from "../contracts.js";
import type { ChangedFile } from "../diff/parse.js";
import { inputHash, type HashedFile } from "../receipts/hash.js";
import { recordPass, type Receipt } from "../receipts/receipt.js";
import type { RunOutcome } from "./outcomes.js";
import { DELETED_FILE_HASH, runGate, type CheckRunner, type GatePorts } from "./run.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

function det(over: Partial<LoadedCheck> = {}): LoadedCheck {
  return {
    id: "typecheck",
    description: "TypeScript compiles.",
    kind: "deterministic",
    severity: "block",
    tiers: ["strict"],
    include: ["src/**/*.ts"],
    exclude: [],
    enabled: true,
    version: 1,
    origin: [],
    command: "npm run typecheck",
    body: "",
    ...over,
  };
}

function lens(over: Partial<LoadedCheck> = {}): LoadedCheck {
  const { command: _drop, ...base } = det();
  return {
    ...base,
    id: "correctness",
    kind: "agent-lens",
    severity: "warn",
    review_lens: "look for correctness bugs",
    ...over,
  };
}

const routing = (over: Partial<Routing> = {}): Routing => ({
  tier: "strict",
  checks: ["typecheck"],
  autonomy: "human-gate",
  modelTier: "sonnet",
  autofix: false,
  ...over,
});

const file = (path: string, status: ChangedFile["status"] = "modified"): ChangedFile => ({
  path,
  status,
});

const FILES = [file("src/a.ts"), file("src/b.ts")];

const HASHES: Record<string, string> = {
  "src/a.ts": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "src/b.ts": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

const AT = new Date("2026-08-08T12:00:00.000Z");

interface Harness {
  readonly ports: GatePorts;
  readonly written: Receipt[];
  readonly ran: string[];
  readonly hashed: string[];
}

function harness(
  over: {
    run?: CheckRunner;
    stored?: Record<string, Receipt>;
    hashFile?: (path: string) => Promise<string>;
    write?: (receipt: Receipt) => Promise<void>;
  } = {},
): Harness {
  const written: Receipt[] = [];
  const ran: string[] = [];
  const hashed: string[] = [];

  const ports: GatePorts = {
    hashFile:
      over.hashFile ??
      (async (path: string) => {
        hashed.push(path);
        const hash = HASHES[path];
        if (hash === undefined) throw new Error(`no fixture hash for ${path}`);
        return hash;
      }),
    clock: { now: () => AT },
    receipts: {
      read: async (checkId) => over.stored?.[checkId] ?? null,
      write:
        over.write ??
        (async (receipt) => {
          written.push(receipt);
        }),
    },
    run:
      over.run ??
      (async (check) => {
        ran.push(check.id);
        return { outcome: { status: "pass" } };
      }),
  };

  return { ports, written, ran, hashed };
}

const hashedFiles = (paths: readonly string[]): HashedFile[] =>
  paths.map((path) => ({ path, hash: HASHES[path] ?? DELETED_FILE_HASH }));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ── the pipeline ─────────────────────────────────────────────────────────────

describe("runGate — select, skip, run, aggregate, record", () => {
  it("runs a selected check and reports its verdict", async () => {
    const h = harness();
    const run = await runGate({ routing: routing(), registry: buildRegistry([det()]), files: FILES }, h.ports);

    expect(h.ran).toEqual(["typecheck"]);
    expect(run.verdict.verdict).toBe("pass");
    expect(run.verdict.results).toHaveLength(1);
    expect(run.verdict.results[0]).toMatchObject({
      checkId: "typecheck",
      checkVersion: 1,
      severity: "block",
      outcome: { status: "pass" },
    });
  });

  it("hands the check exactly the files it matched, not the whole diff", async () => {
    const seen: string[][] = [];
    const h = harness({
      run: async (_check, files) => {
        seen.push(files.map((f) => f.path));
        return { outcome: { status: "pass" } };
      },
    });
    await runGate(
      {
        routing: routing(),
        registry: buildRegistry([det({ exclude: ["src/b.ts"] })]),
        files: [...FILES, file("README.md")],
      },
      h.ports,
    );
    expect(seen).toEqual([["src/a.ts"]]);
  });

  it("emits results in routing order, whatever order the checks finished in", async () => {
    const h = harness();
    const run = await runGate(
      {
        routing: routing({ checks: ["correctness", "typecheck"] }),
        registry: buildRegistry([det(), lens()]),
        files: FILES,
      },
      h.ports,
    );
    expect(run.verdict.results.map((r) => r.checkId)).toEqual(["correctness", "typecheck"]);
  });

  it("blocks when a `block` check fails, and exits with the warn one still a warning", async () => {
    const h = harness({
      run: async (check) => ({
        outcome:
          check.id === "typecheck"
            ? { status: "fail", detail: "TS2345" }
            : { status: "fail", detail: "looks wrong" },
      }),
    });
    const run = await runGate(
      {
        routing: routing({ checks: ["typecheck", "correctness"] }),
        registry: buildRegistry([det(), lens()]),
        files: FILES,
      },
      h.ports,
    );

    expect(run.verdict.verdict).toBe("block");
    expect(run.verdict.blocking).toEqual(["typecheck"]);
    expect(run.verdict.warnings).toEqual(["correctness"]);
  });

  it("passes honestly when no check applied to the change", async () => {
    const h = harness();
    const run = await runGate(
      {
        routing: routing(),
        registry: buildRegistry([det({ include: ["docs/**/*.md"] })]),
        files: FILES,
      },
      h.ports,
    );

    expect(run.verdict.verdict).toBe("pass");
    expect(run.verdict.results).toEqual([]);
    expect(run.selection.unmatched).toEqual(["typecheck"]);
    expect(h.ran).toEqual([]);
  });

  it("reports an excluded check as skipped with its reason", async () => {
    const h = harness();
    const run = await runGate(
      { routing: routing(), registry: buildRegistry([det({ enabled: false })]), files: FILES },
      h.ports,
    );

    expect(run.verdict.skipped).toEqual(["typecheck"]);
    expect(run.verdict.results[0]?.outcome).toEqual({ status: "skipped", reason: "disabled" });
    expect(h.ran).toEqual([]);
  });
});

// ── rule 1, end to end ───────────────────────────────────────────────────────

describe("rule 1 — the gate being broken never blocks a change", () => {
  it("turns a runner that THROWS into an errored result, not a failure", async () => {
    // A crashing adapter is the most likely way this rule gets broken in practice:
    // an unhandled rejection that bubbles up as "the check failed".
    const h = harness({
      run: async () => {
        throw new Error("EACCES: permission denied");
      },
    });
    const run = await runGate({ routing: routing(), registry: buildRegistry([det()]), files: FILES }, h.ports);

    expect(run.verdict.errored).toEqual(["typecheck"]);
    expect(run.verdict.blocking).toEqual([]);
    expect(run.verdict.verdict).toBe("pass");
    expect(run.verdict.results[0]?.outcome).toMatchObject({ status: "errored" });
  });

  it("errors — and does not block — when routing names a check the registry does not have", async () => {
    // We do not know the missing check's severity, so we assume the WORST: `block`.
    // It still does not block, which is rule 1 holding at its hardest point.
    const h = harness();
    const run = await runGate(
      { routing: routing({ checks: ["ghost"] }), registry: buildRegistry([]), files: FILES },
      h.ports,
    );

    expect(run.verdict.errored).toEqual(["ghost"]);
    expect(run.verdict.blocking).toEqual([]);
    expect(run.verdict.verdict).toBe("pass");
    expect(run.verdict.results[0]?.severity).toBe("block");
  });

  it("does not block when a blocking check errors alongside a passing one", async () => {
    const h = harness({
      run: async (check) =>
        check.id === "typecheck"
          ? { outcome: { status: "errored", detail: "budget exhausted" } }
          : { outcome: { status: "pass" } },
    });
    const run = await runGate(
      {
        routing: routing({ checks: ["typecheck", "test"] }),
        registry: buildRegistry([det(), det({ id: "test", command: "npm test" })]),
        files: FILES,
      },
      h.ports,
    );

    expect(run.verdict.verdict).toBe("pass");
    expect(run.verdict.errored).toEqual(["typecheck"]);
  });
});

// ── rule 3 + receipts ────────────────────────────────────────────────────────

describe("rule 3 — receipts are written on pass only", () => {
  it("records a pass receipt bound to the matched files and the check version", async () => {
    const h = harness();
    const run = await runGate(
      { routing: routing(), registry: buildRegistry([det({ version: 7 })]), files: FILES },
      h.ports,
    );

    expect(h.written).toEqual([
      recordPass({
        checkId: "typecheck",
        checkVersion: 7,
        files: hashedFiles(["src/a.ts", "src/b.ts"]),
        at: AT,
      }),
    ]);
    expect(run.receiptsWritten).toEqual(["typecheck"]);
  });

  it("writes NO receipt for a check that failed", async () => {
    const h = harness({ run: async () => ({ outcome: { status: "fail", detail: "nope" } }) });
    await runGate({ routing: routing(), registry: buildRegistry([det()]), files: FILES }, h.ports);
    expect(h.written).toEqual([]);
  });

  it("writes NO receipt for a check that errored", async () => {
    const h = harness({ run: async () => ({ outcome: { status: "errored", detail: "boom" } }) });
    await runGate({ routing: routing(), registry: buildRegistry([det()]), files: FILES }, h.ports);
    expect(h.written).toEqual([]);
  });

  it("writes NO receipt for a check that was skipped", async () => {
    const stored = {
      typecheck: recordPass({
        checkId: "typecheck",
        checkVersion: 1,
        files: hashedFiles(["src/a.ts", "src/b.ts"]),
        at: AT,
      }),
    };
    const h = harness({ stored });
    await runGate({ routing: routing(), registry: buildRegistry([det()]), files: FILES }, h.ports);
    expect(h.written).toEqual([]);
  });

  it("writes NO receipt for an excluded check — a disabled check has not passed anything", async () => {
    const h = harness();
    await runGate(
      { routing: routing(), registry: buildRegistry([det({ enabled: false })]), files: FILES },
      h.ports,
    );
    expect(h.written).toEqual([]);
  });

  it("keeps the verdict when persisting a receipt fails — a cache write cannot change it", async () => {
    const h = harness({
      write: async () => {
        throw new Error("EROFS: read-only file system");
      },
    });
    const run = await runGate({ routing: routing(), registry: buildRegistry([det()]), files: FILES }, h.ports);

    expect(run.verdict.verdict).toBe("pass");
    expect(run.verdict.results[0]?.outcome).toEqual({ status: "pass" });
    expect(run.receiptsWritten).toEqual([]);
    expect(run.receiptErrors).toHaveLength(1);
  });
});

describe("rule 4 — a receipt skip is a skip, and it is honest", () => {
  const receiptFor = (version = 1): Receipt =>
    recordPass({
      checkId: "typecheck",
      checkVersion: version,
      files: hashedFiles(["src/a.ts", "src/b.ts"]),
      at: AT,
    });

  it("does not run a check whose receipt proves it already passed on this input", async () => {
    const h = harness({ stored: { typecheck: receiptFor() } });
    const run = await runGate({ routing: routing(), registry: buildRegistry([det()]), files: FILES }, h.ports);

    expect(h.ran).toEqual([]);
    expect(run.verdict.skipped).toEqual(["typecheck"]);
    expect(run.verdict.results[0]?.outcome).toEqual({ status: "skipped", reason: "receipt" });
  });

  it("passes when EVERY check was skipped by a receipt — correct, not a hole", async () => {
    const stored = {
      typecheck: receiptFor(),
      test: recordPass({
        checkId: "test",
        checkVersion: 1,
        files: hashedFiles(["src/a.ts", "src/b.ts"]),
        at: AT,
      }),
    };
    const h = harness({ stored });
    const run = await runGate(
      {
        routing: routing({ checks: ["typecheck", "test"] }),
        registry: buildRegistry([det(), det({ id: "test", command: "npm test" })]),
        files: FILES,
      },
      h.ports,
    );

    expect(h.ran).toEqual([]);
    expect(run.verdict.verdict).toBe("pass");
    expect(run.verdict.skipped).toEqual(["typecheck", "test"]);
  });

  it("re-runs when the check's version moved, even though the files did not", async () => {
    // The version is inside the hash. Without this, editing a check's behaviour
    // would silently reuse a receipt earned by the previous version.
    const h = harness({ stored: { typecheck: receiptFor(1) } });
    await runGate(
      { routing: routing(), registry: buildRegistry([det({ version: 2 })]), files: FILES },
      h.ports,
    );
    expect(h.ran).toEqual(["typecheck"]);
  });

  it("re-runs when a matched file's content changed", async () => {
    const stale = recordPass({
      checkId: "typecheck",
      checkVersion: 1,
      files: [
        { path: "src/a.ts", hash: "9999999999999999999999999999999999999999" },
        { path: "src/b.ts", hash: HASHES["src/b.ts"] ?? "" },
      ],
      at: AT,
    });
    const h = harness({ stored: { typecheck: stale } });
    await runGate({ routing: routing(), registry: buildRegistry([det()]), files: FILES }, h.ports);
    expect(h.ran).toEqual(["typecheck"]);
  });

  it("re-runs — never skips — when reading the receipt store throws", async () => {
    // Receipts are a cache. Every ambiguity resolves toward re-running: a wrongly
    // skipped check is an unnoticed hole, a wrongly re-run one costs seconds.
    const h = harness();
    const ports: GatePorts = {
      ...h.ports,
      receipts: {
        read: async () => {
          throw new Error("EIO");
        },
        write: h.ports.receipts.write,
      },
    };
    await runGate({ routing: routing(), registry: buildRegistry([det()]), files: FILES }, ports);
    expect(h.ran).toEqual(["typecheck"]);
  });
});

// ── hashing ──────────────────────────────────────────────────────────────────

describe("hashing the receipt input", () => {
  it("hashes each path once, however many checks matched it", async () => {
    const h = harness();
    await runGate(
      {
        routing: routing({ checks: ["typecheck", "test", "correctness"] }),
        registry: buildRegistry([det(), det({ id: "test", command: "npm test" }), lens()]),
        files: FILES,
      },
      h.ports,
    );
    expect(h.hashed).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("never asks git to hash a deleted file — it is gone, and the absence is the input", async () => {
    const h = harness();
    const run = await runGate(
      {
        routing: routing(),
        registry: buildRegistry([det()]),
        files: [file("src/a.ts"), file("src/gone.ts", "deleted")],
      },
      h.ports,
    );

    expect(h.hashed).toEqual(["src/a.ts"]);
    expect(h.written[0]?.inputHash).toBe(
      inputHash(
        [
          { path: "src/a.ts", hash: HASHES["src/a.ts"] ?? "" },
          { path: "src/gone.ts", hash: DELETED_FILE_HASH },
        ],
        1,
      ),
    );
    expect(run.verdict.verdict).toBe("pass");
  });

  it("still runs the check when a file cannot be hashed, but records no receipt", async () => {
    const h = harness({
      hashFile: async (path) => {
        if (path === "src/b.ts") throw new Error("could not hash src/b.ts");
        return HASHES[path] ?? "";
      },
    });
    const run = await runGate({ routing: routing(), registry: buildRegistry([det()]), files: FILES }, h.ports);

    expect(h.ran).toEqual(["typecheck"]);
    expect(run.verdict.verdict).toBe("pass");
    expect(h.written).toEqual([]);
    expect(run.receiptsWritten).toEqual([]);
  });
});

// ── scheduling ───────────────────────────────────────────────────────────────

describe("scheduling — deterministic checks are free, judgements are not", () => {
  it("runs deterministic checks concurrently", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<RunOutcome>>>();
    const started: string[] = [];
    const h = harness({
      run: (check) => {
        started.push(check.id);
        const d = deferred<RunOutcome>();
        gates.set(check.id, d);
        return d.promise;
      },
    });

    const promise = runGate(
      {
        routing: routing({ checks: ["typecheck", "test"] }),
        registry: buildRegistry([det(), det({ id: "test", command: "npm test" })]),
        files: FILES,
      },
      h.ports,
    );

    await vi.waitFor(() => expect(started).toEqual(["typecheck", "test"]));
    for (const d of gates.values()) d.resolve({ outcome: { status: "pass" } });

    const run = await promise;
    expect(run.verdict.verdict).toBe("pass");
  });

  it("runs agent-lens checks ONE AT A TIME — each one costs money", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<RunOutcome>>>();
    const started: string[] = [];
    const h = harness({
      run: (check) => {
        started.push(check.id);
        const d = deferred<RunOutcome>();
        gates.set(check.id, d);
        return d.promise;
      },
    });

    const promise = runGate(
      {
        routing: routing({ checks: ["correctness", "security"] }),
        registry: buildRegistry([lens(), lens({ id: "security", review_lens: "security" })]),
        files: FILES,
      },
      h.ports,
    );

    await vi.waitFor(() => expect(started).toEqual(["correctness"]));
    gates.get("correctness")?.resolve({ outcome: { status: "pass" }, costUsd: 0.05 });

    await vi.waitFor(() => expect(started).toEqual(["correctness", "security"]));
    gates.get("security")?.resolve({ outcome: { status: "pass" }, costUsd: 0.03 });

    const run = await promise;
    expect(run.verdict.totalCostUsd).toBeCloseTo(0.08);
  });

  it("runs the agent lens even when a deterministic check already blocked", async () => {
    // No short-circuit. `CheckOutcome` has no honest reason code for "we stopped
    // early", and rule 4 says a skipped check must be reported with its reason —
    // so the alternative would be a lie. If the cost of that ever matters, it needs
    // a new skip reason in the shared contract, which is a conversation.
    const ran: string[] = [];
    const h = harness({
      run: async (check) => {
        ran.push(check.id);
        return {
          outcome:
            check.kind === "deterministic"
              ? { status: "fail", detail: "TS2345" }
              : { status: "pass" },
        };
      },
    });
    const run = await runGate(
      {
        routing: routing({ checks: ["typecheck", "correctness"] }),
        registry: buildRegistry([det(), lens()]),
        files: FILES,
      },
      h.ports,
    );

    expect(ran).toEqual(["typecheck", "correctness"]);
    expect(run.verdict.verdict).toBe("block");
  });

  it("carries an agent lens's cost onto its result", async () => {
    const h = harness({ run: async () => ({ outcome: { status: "pass" }, costUsd: 0.04 }) });
    const run = await runGate(
      { routing: routing({ checks: ["correctness"] }), registry: buildRegistry([lens()]), files: FILES },
      h.ports,
    );
    expect(run.verdict.results[0]?.costUsd).toBeCloseTo(0.04);
    expect(run.verdict.totalCostUsd).toBeCloseTo(0.04);
  });
});
