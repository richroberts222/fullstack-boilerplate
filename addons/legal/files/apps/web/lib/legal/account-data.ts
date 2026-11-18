import type { Database } from "../../db/client";
import { legalAccountData, type AccountDataPart } from "../../db/legal";
import { createRateLimitRepo } from "../../db/rate-limits";
// addons: account data imports

// Every feature's share of a member's data, for "Download my data" and "Delete my account"
// (/docs/features/legal-gate.md "Account data parts"). Add a part for every new table that holds a
// member's data: `account-data.test.ts` fails until every such table in /docs/data-inventory.md is covered.
// Building the list touches no database; each part runs its queries only when called.

export function accountDataParts(db: Database): AccountDataPart[] {
  return [
    legalAccountData(db),
    { name: "rateLimits", tables: ["rate_limits"], exportFor: async () => [], deletionStatements: (userId) => [createRateLimitRepo(db).deleteForUserStatement(userId)] },
    // addons: account data parts
  ];
}
