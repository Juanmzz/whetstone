/**
 * The `files` memory adapter, and the one place that picks one.
 *
 * `.wst/memory/signals.jsonl`, which is what non-negotiable 1 means by "the file
 * backend alone: no required servers or databases".
 */

import type { MemoryPort } from "../core/memory/port.js";
import type { WstConfig } from "../core/config/schema.js";
import type { SignalRecord } from "../core/signals/parse.js";
import { appendSignalRecord, readSignalLog } from "./signals.js";
import { loadConfig } from "./config.js";

export function filesMemory(definitionRoot: string): MemoryPort {
  return {
    all: () => readSignalLog(definitionRoot),
    async save(records: readonly SignalRecord[]) {
      const ids: string[] = [];
      for (const record of records) {
        await appendSignalRecord(definitionRoot, record);
        ids.push(record.id);
      }
      return ids;
    },
  };
}

/** The adapter the config asks for. One ships; `backend:` is where a second arrives. */
export function memoryFor(config: WstConfig, definitionRoot: string): MemoryPort {
  switch (config.backend) {
    case "files":
      return filesMemory(definitionRoot);
  }
}

/** Read the config and build the store. What a composition root wants. */
export async function resolveMemory(definitionRoot: string): Promise<MemoryPort> {
  return memoryFor(await loadConfig(definitionRoot), definitionRoot);
}
