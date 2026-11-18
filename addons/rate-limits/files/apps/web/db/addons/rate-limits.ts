import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Rate-limits add-on (/docs/features/rate-limits.md). One row per limited action and member, counting
// requests in the current window. Rows older than a day are removed as the limiter runs.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});
