import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Privacy Policy coverage guard (/docs/features/legal-gate.md). Every table that holds personal data (a T2
// or T3 column in /docs/data-inventory.md) is listed here with words the Privacy Policy page uses for it. A
// new table with personal data fails this test until someone updates the policy (and PRIVACY_VERSION, so
// members are asked again) and lists the table below. Learned in a production application, where two
// features shipped without a line in the policy.

const COVERED: Record<string, string> = {
  legal_acceptances: "Your acceptance of these terms",
  rate_limits: "Counts of your recent requests",
  // addons: privacy coverage
};

const root = path.join(__dirname, "..", "..", "..", "..");
const inventory = readFileSync(path.join(root, "docs", "data-inventory.md"), "utf8");
const page = readFileSync(path.join(__dirname, "page.tsx"), "utf8").replace(/&apos;/g, "'");

/** Tables with at least one T2 or T3 column in the inventory. */
export function personalTables(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(/^\|\s*`?([a-z0-9_]+)\.[a-z0-9_]+`?\s*\|\s*T[23]\s*\|/gm)) out.add(m[1]!);
  return [...out].sort();
}

describe("privacy policy coverage", () => {
  it("names every table that holds personal data", () => {
    const missing = personalTables(inventory).filter((t) => !(t in COVERED));
    expect(missing, "add a line to app/privacy/page.tsx, change PRIVACY_VERSION, then list the table in COVERED").toEqual([]);
  });

  it("each listed phrase is really on the Privacy Policy page", () => {
    expect(Object.entries(COVERED).filter(([, phrase]) => !page.includes(phrase)).map(([t]) => t)).toEqual([]);
  });

  it("reads the inventory's tiers (self-test)", () => {
    expect(personalTables("| a.x | T1 | p |\n| b.y | T2 | p |\n| `c.z` | T3 | p |")).toEqual(["b", "c"]);
  });
});
