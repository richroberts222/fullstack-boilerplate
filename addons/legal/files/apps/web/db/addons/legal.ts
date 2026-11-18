import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Legal add-on (/docs/features/legal-gate.md). A member's acceptance of the Terms and the Privacy Policy,
// with the versions they saw, the age they confirmed and when. One row per acceptance; the newest counts.
export const legalAcceptances = pgTable(
  "legal_acceptances",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    termsVersion: text("terms_version").notNull(),
    privacyVersion: text("privacy_version").notNull(),
    minimumAge: integer("minimum_age").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("legal_acceptances_user_idx").on(t.userId)],
);
