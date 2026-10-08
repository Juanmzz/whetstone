#!/usr/bin/env node
/**
 * What `wst` resolves to: the Node floor, then the CLI.
 *
 * A static import is resolved before any line runs, so `cli.ts` cannot check the
 * version itself. It is imported dynamically, after the check, and nothing here may
 * import anything else.
 */

import { createRequire } from "node:module";
import { tooOldMessage } from "./node-floor.js";

const engines = (createRequire(import.meta.url)("../package.json") as { engines: { node: string } }).engines.node;
const tooOld = tooOldMessage(process.versions.node, engines);

if (tooOld !== null) {
  console.error(tooOld);
  process.exitCode = 2;
} else {
  import("./cli.js").catch((cause: unknown) => {
    console.error(cause);
    console.error("\nwhetstone could not start. Nothing was verified by this run.");
    process.exitCode = 2;
  });
}
