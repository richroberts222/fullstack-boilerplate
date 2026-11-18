import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { Database } from "../../db/client";
import { accountDataParts } from "./account-data";

// Account data coverage guard (/docs/features/legal-gate.md). Every table in /docs/data-inventory.md with a
// member's id (a `user_id` or `owner_id` column) must be covered by an account data part, so "Download my
// data" and "Delete my account" can never silently miss a feature's table.

const inventory = readFileSync(path.join(__dirname, "..", "..", "..", "..", "docs", "data-inventory.md"), "utf8");

/** Tables whose inventory rows include a member id column. */
export function memberTables(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(/^\|\s*`?([a-z0-9_]+)\.(?:user_id|owner_id)`?\s*\|/gm)) out.add(m[1]!);
  return [...out].sort();
}

describe("account data parts", () => {
  const parts = accountDataParts({} as Database);

  it("cover every table that holds a member id", () => {
    const covered = new Set(parts.flatMap((p) => p.tables));
    expect(memberTables(inventory).filter((t) => !covered.has(t)), "add an account data part in lib/legal/account-data.ts").toEqual([]);
  });

  it("have distinct export names", () => {
    const names = parts.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("the scan finds member id columns (self-test)", () => {
    expect(memberTables("| a.user_id | T2 | p | r | d |\n| b.owner_id | T2 | p | r | d |\n| c.id | T1 | p | r | d |")).toEqual(["a", "b"]);
  });
});
