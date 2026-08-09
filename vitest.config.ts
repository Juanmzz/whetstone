import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Live LLM tests self-skip via `describe.skipIf(!process.env.WST_LIVE_LLM)`
    // rather than being excluded here — so they stay visible in the run output
    // as skipped, instead of silently not existing.
    environment: "node",
  },
});
