/**
 * `.wst/wst.yaml` off the disk. The extension points both read from here.
 */

import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG, parseConfig, type WstConfig } from "../core/config/schema.js";

export const CONFIG_FILE = "wst.yaml";

/**
 * `.wst/wst.yaml`, or the defaults when it is absent or unreadable.
 *
 * Absent is normal — every repo has none until `init` runs. A file that IS
 * there and declares something unrunnable throws, because that is a request the
 * tool cannot honour and honouring it silently is the failure the key prevents.
 */
export async function loadConfig(definitionRoot: string): Promise<WstConfig> {
  let text: string;
  try {
    text = await readFile(join(definitionRoot, CONFIG_FILE), "utf-8");
  } catch {
    return DEFAULT_CONFIG;
  }
  return parseConfig(parseYaml(text));
}
