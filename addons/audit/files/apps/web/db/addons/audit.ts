import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Audit add-on: owner settings (key and value) and the audit trail of owner changes.
/**
 * Owner settings (/docs/features/site-settings.md): one row per setting. The value is validated by
 * the shared settings schema before it is written and when it is read; unknown keys are ignored.
 */
export const siteSettings = pgTable("site_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Who changed what and when, with the prior value, for owner actions that matter (/docs/permissions.md rule 6). */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    action: text("action").notNull(),
    subject: text("subject").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_created_idx").on(t.createdAt)],
);
