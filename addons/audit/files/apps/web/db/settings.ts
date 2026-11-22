import { sql } from "drizzle-orm";

import type { Database } from "./client";
import { withDbErrors } from "./errors";
import { auditEvents, siteSettings } from "./schema";

// Settings and audit data access (/docs/database.md section 8).

type Statement = Parameters<Database["batch"]>[0][number];

export type AuditEvent = { id: string; actorUserId: string; action: string; subject: string; before: unknown; after: unknown };

export type SettingsRepo = {
  listSettings(): Promise<{ key: string; value: unknown }[]>;
  /** Insert or replace one setting; run with the audit statement as one atomic unit. */
  upsertStatement(key: string, value: unknown): Statement;
};

export type AuditRepo = {
  insertStatement(event: AuditEvent): Statement;
};

export function createSettingsRepo(db: Database): SettingsRepo {
  return {
    listSettings: () => withDbErrors("settings.list", () => db.select({ key: siteSettings.key, value: siteSettings.value }).from(siteSettings)),
    upsertStatement: (key, value) =>
      db
        .insert(siteSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: siteSettings.key, set: { value, updatedAt: sql`now()` } }),
  };
}

export function createAuditRepo(db: Database): AuditRepo {
  return {
    insertStatement: (event) => db.insert(auditEvents).values(event),
  };
}
