import { desc, eq } from "drizzle-orm";

import type { Database } from "./client";
import { withDbErrors } from "./errors";
import { legalAcceptances } from "./addons/legal";

// Legal data access (/docs/features/legal-gate.md): acceptances, and the "account data part" contract
// that lets every feature take part in a member's data export and account deletion.

type Statement = Parameters<Database["batch"]>[0][number];

export type AcceptanceRow = { id: string; userId: string; termsVersion: string; privacyVersion: string; minimumAge: number; acceptedAt: Date };

/**
 * One feature's share of a member's data (/docs/features/legal-gate.md "Account data parts"). Every table
 * that holds a member's data has a part, listed in `lib/legal/account-data.ts`; a test checks the list
 * against /docs/data-inventory.md.
 */
export type AccountDataPart = {
  /** The section name in the export file. */
  name: string;
  /** The tables this part covers (for the coverage check). */
  tables: string[];
  /** The member's rows, as plain objects, without their user id. */
  exportFor(userId: string): Promise<Record<string, unknown>[]>;
  /** Statements that delete (or anonymize, with a stated reason) the member's rows; all parts run in one atomic unit. */
  deletionStatements(userId: string, anonId: string): Statement[];
  /** Runs before anything is deleted (for example, stopping a plan that still bills); throwing stops the deletion. */
  beforeDelete?(userId: string): Promise<void>;
};

export type LegalRepo = {
  latestAcceptance(userId: string): Promise<AcceptanceRow | null>;
  insertAcceptance(row: AcceptanceRow): Promise<void>;
};

export function createLegalRepo(db: Database): LegalRepo {
  return {
    latestAcceptance: (userId) =>
      withDbErrors("legal.latestAcceptance", async () => {
        const [row] = await db.select().from(legalAcceptances).where(eq(legalAcceptances.userId, userId)).orderBy(desc(legalAcceptances.acceptedAt)).limit(1);
        return row ?? null;
      }),
    insertAcceptance: (row) =>
      withDbErrors("legal.insertAcceptance", async () => {
        await db.insert(legalAcceptances).values(row);
      }),
  };
}

/** The acceptances' part: exported, and deleted with the account. */
export function legalAccountData(db: Database): AccountDataPart {
  return {
    name: "acceptances",
    tables: ["legal_acceptances"],
    exportFor: (userId) =>
      withDbErrors("legal.exportFor", () =>
        db
          .select({ termsVersion: legalAcceptances.termsVersion, privacyVersion: legalAcceptances.privacyVersion, minimumAge: legalAcceptances.minimumAge, acceptedAt: legalAcceptances.acceptedAt })
          .from(legalAcceptances)
          .where(eq(legalAcceptances.userId, userId)),
      ),
    deletionStatements: (userId) => [db.delete(legalAcceptances).where(eq(legalAcceptances.userId, userId))],
  };
}
