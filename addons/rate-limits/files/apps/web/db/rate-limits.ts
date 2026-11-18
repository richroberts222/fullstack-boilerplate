import { like, lt, sql } from "drizzle-orm";

import type { Database } from "./client";
import { withDbErrors } from "./errors";
import { rateLimits } from "./addons/rate-limits";

// Rate-limit counts (/docs/features/rate-limits.md). One atomic statement per request, so two requests at
// the same moment both count, on any number of servers.

type Statement = Parameters<Database["batch"]>[0][number];

export type RateLimitRepo = {
  /** Counts one request for `key` and returns the count in the current window; a window older than `windowSeconds` starts again at 1. */
  hit(key: string, windowSeconds: number, now: Date): Promise<number>;
  /** Removes rows whose window started before `before`; returns how many. */
  deleteBefore(before: Date): Promise<number>;
  /** Removes one member's rows (account deletion). */
  deleteForUserStatement(userId: string): Statement;
};

/** A LIKE pattern for every key of one member ("<limit>:<userId>"); the id's own wildcards match only themselves. */
export function userKeyPattern(userId: string): string {
  return `%:${userId.replace(/[\\%_]/g, (c) => "\\" + c)}`;
}

export function createRateLimitRepo(db: Database): RateLimitRepo {
  return {
    hit: (key, windowSeconds, now) =>
      withDbErrors("rateLimits.hit", async () => {
        const cutoff = new Date(now.getTime() - windowSeconds * 1000);
        const [row] = await db
          .insert(rateLimits)
          .values({ key, windowStart: now, count: 1 })
          .onConflictDoUpdate({
            target: rateLimits.key,
            set: {
              count: sql`case when ${rateLimits.windowStart} < ${cutoff} then 1 else ${rateLimits.count} + 1 end`,
              windowStart: sql`case when ${rateLimits.windowStart} < ${cutoff} then ${now} else ${rateLimits.windowStart} end`,
            },
          })
          .returning({ count: rateLimits.count });
        return row?.count ?? 1;
      }),
    deleteBefore: (before) =>
      withDbErrors("rateLimits.deleteBefore", async () => (await db.delete(rateLimits).where(lt(rateLimits.windowStart, before)).returning({ key: rateLimits.key })).length),
    deleteForUserStatement: (userId) => db.delete(rateLimits).where(like(rateLimits.key, userKeyPattern(userId))),
  };
}
