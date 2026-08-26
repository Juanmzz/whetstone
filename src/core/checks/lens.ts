/**
 * Reading a lens in order to MEASURE it. PURE.
 *
 * A second door, not a wider first one (`sig-b828c2b1`). What comes through it
 * is not a `Check`: it carries no severity to grant.
 */

import type { Agent } from "../config/schema.js";
import { parseDefinition } from "./registry.js";

export interface LensUnderTest {
  readonly id: string;
  readonly lens: string;
  readonly agent: Agent | undefined;
  readonly fixtures: string;
}

export function parseLensUnderTest(filename: string, contents: string): LensUnderTest {
  const { check } = parseDefinition(filename, contents);

  if (check.kind !== "llm" || check.review_lens === undefined) {
    throw new Error(`check "${check.id}" is not an llm check: there is no lens to measure`);
  }

  const fixtures = check.calibration?.fixtures;
  if (fixtures === undefined) {
    throw new Error(
      `check "${check.id}" declares no \`calibration.fixtures\`: nothing to measure it against`,
    );
  }

  return {
    id: check.id,
    lens: check.review_lens,
    ...(check.agent === undefined ? {} : { agent: check.agent }),
    fixtures,
  } as LensUnderTest;
}
