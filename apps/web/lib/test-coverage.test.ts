import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { auditTestCoverage } from "../../../scripts/audit-test-coverage.mjs";

// The rule "every feature has tests around it" (docs/qa-strategy.md section 3, item 4a), as a guard. Every control
// on a screen has a test id; a control whose id no test mentions has no test that drives it. The known gaps are
// listed in docs/test-coverage-baseline.json (explained in docs/test-coverage-map.md). The list may only shrink: a
// new control without a test fails here, and so does an id that is now covered but still listed.
// An add-on may ship its own list next to the main one (docs/test-coverage-baseline.<add-on>.json) for the ids it cannot
// drive in a browser without a payment provider or a particular account state; each list is explained in the add-on's feature document.
const docsDir = join(__dirname, "../../../docs");
const baseline = readdirSync(docsDir)
  .filter((f) => /^test-coverage-baseline(\.[a-z0-9-]+)?\.json$/.test(f))
  .flatMap((f) => (JSON.parse(readFileSync(join(docsDir, f), "utf8")) as { untestedTestIds: string[] }).untestedTestIds);

describe("test coverage of screen controls", () => {
  const { untestedIds } = auditTestCoverage();
  const current = untestedIds.map((u) => u.id);

  it("every new control has a test that mentions its test id", () => {
    const known = new Set(baseline);
    const added = untestedIds.filter((u) => !known.has(u.id)).map((u) => `${u.id} (${u.file})`);
    expect(added, "add a browser or component test that uses these test ids (docs/qa-strategy.md section 3)").toEqual([]);
  });

  it("the known-gap list keeps only ids that are still untested", () => {
    const now = new Set(current);
    const stale = baseline.filter((id) => !now.has(id));
    expect(stale, "these are covered now (or removed): delete them from docs/test-coverage-baseline.json").toEqual([]);
  });
});
